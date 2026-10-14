# -----------------------------------------------------------------------------
# Cognito Authentication Component
# Native aws_cognito_* resources only — no external modules
# Pattern follows UNO-WORKSPACE/AT/cognito/main.tf
# -----------------------------------------------------------------------------

# Cognito User Pool

locals {
  entra_callback_urls = length(var.entra_callback_urls) > 0 ? var.entra_callback_urls : var.callback_urls
  entra_logout_urls   = length(var.entra_logout_urls) > 0 ? var.entra_logout_urls : var.logout_urls
  entra_placeholder_metadata_url = "https://login.microsoftonline.com/placeholder-tenant-id/federationmetadata/2007-06/federationmetadata.xml?appid=placeholder-app-id"
  # For first apply, permit an implicit placeholder URL when explicitly allowed.
  entra_effective_metadata_url = var.entra_metadata_url != "" ? var.entra_metadata_url : (var.allow_placeholder_entra_metadata_url && var.entra_metadata_file == "" ? local.entra_placeholder_metadata_url : "")
}


resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-user-pool"

  # Disable self-registration — admin must create all users
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # Strong password policy (8+ chars, uppercase, lowercase, numbers, symbols)
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # Auto-verified attributes
  auto_verified_attributes = ["email"]

  # Username configuration
  username_attributes = ["email"]

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Advanced security mode enforced
  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  # Lambda triggers (Pre-Authentication for Entra ID)
  dynamic "lambda_config" {
    for_each = var.enable_pre_auth_lambda ? [1] : []
    content {
      pre_authentication = aws_lambda_function.pre_auth[0].arn
    }
  }

  # Email configuration
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Schema: email (required)
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Schema: custom role attribute (values: read_write, read_only, partner)
  schema {
    name                = "role"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  tags = var.tags
}

# -----------------------------------------------------------------------------
# Cognito User Pool — Entra ID Federation (Optional)
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool" "entra" {
  count = var.create_entra_user_pool ? 1 : 0

  name = "${var.project_name}-entra-user-pool"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  user_pool_add_ons {
    advanced_security_mode = "ENFORCED"
  }

  # Lambda triggers (Pre-Authentication for Entra ID)
  dynamic "lambda_config" {
    for_each = var.enable_pre_auth_lambda ? [1] : []
    content {
      pre_authentication = aws_lambda_function.pre_auth[0].arn
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  schema {
    name                = "role"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 20
    }
  }

  # Schema: groups claim from Entra ID (space-separated or single group name)
  schema {
    name                = "groups"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }

  tags = merge(var.tags, { IdentityProvider = "EntraID" })

  lifecycle {
    precondition {
      condition = var.entra_domain_suffix != "" && ((var.entra_metadata_url != "" && var.entra_metadata_file == "") || (var.entra_metadata_url == "" && var.entra_metadata_file != "") || (var.entra_metadata_url == "" && var.entra_metadata_file == "" && var.allow_placeholder_entra_metadata_url)) && (var.entra_metadata_url != local.entra_placeholder_metadata_url || var.allow_placeholder_entra_metadata_url)
      error_message = "When create_entra_user_pool is true, entra_domain_suffix must be set and exactly one of entra_metadata_url or entra_metadata_file must be provided. If using the placeholder metadata URL for the first apply, set allow_placeholder_entra_metadata_url = true and replace it before the second apply."
    }
  }
}

# -----------------------------------------------------------------------------
# Cognito User Pool Domain
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-${var.domain_suffix}"
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_user_pool_domain" "entra" {
  count = var.create_entra_user_pool ? 1 : 0

  domain       = "${var.project_name}-${var.entra_domain_suffix}"
  user_pool_id = aws_cognito_user_pool.entra[0].id
}

# -----------------------------------------------------------------------------
# Cognito Identity Provider — Entra ID SAML (Optional)
# -----------------------------------------------------------------------------

resource "aws_cognito_identity_provider" "entra" {
  count = var.create_entra_user_pool ? 1 : 0

  user_pool_id       = aws_cognito_user_pool.entra[0].id
  provider_name      = var.entra_identity_provider_name
  provider_type      = "SAML"
  attribute_mapping = var.entra_attribute_mapping

  provider_details = merge(
    {
      IDPSignout = tostring(var.entra_idp_signout)
    },
    var.entra_metadata_file != "" ? {
      MetadataFile = var.entra_metadata_file
    } : {
      MetadataURL = local.entra_effective_metadata_url
    }
  )
}

# -----------------------------------------------------------------------------
# Cognito User Pool Client — ALB Integration
# OAuth 2.0 authorization code flow, generate_secret = true, 60 min tokens
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "alb" {
  name         = "${var.project_name}-alb-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # OAuth settings
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  # Callback URLs (ALB DNS)
  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # Token validity — 60 min access/id, 30 day refresh
  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # ALB requires client secret only when using authenticate-cognito action
  # When using Nginx proxy for auth, no secret needed
  generate_secret = var.generate_client_secret

  # Read and write attributes
  read_attributes  = ["email", "email_verified", "custom:role"]
  write_attributes = ["email", "custom:role"]
}

# -----------------------------------------------------------------------------
# Cognito User Pool Client — ALB Integration
# OAuth 2.0 authorization code flow, generate_secret = true, 60 min tokens
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "entra_alb" {
  count = var.create_entra_user_pool ? 1 : 0

  name         = "${var.project_name}-entra-alb-client"
  user_pool_id = aws_cognito_user_pool.entra[0].id

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  callback_urls = local.entra_callback_urls
  logout_urls   = local.entra_logout_urls

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  supported_identity_providers = [aws_cognito_identity_provider.entra[0].provider_name]
  generate_secret              = var.generate_client_secret

  read_attributes  = ["email", "email_verified", "custom:role", "custom:groups"]
  write_attributes = ["email", "custom:role", "custom:groups"]
}

# -----------------------------------------------------------------------------
# Cognito User Pool Client — Frontend SPA (Conditional)
# No secret for SPA, token revocation enabled
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "frontend" {
  count = var.create_frontend_client ? 1 : 0

  name         = "${var.project_name}-frontend-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # OAuth settings
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]

  # Callback URLs
  callback_urls = var.frontend_callback_urls
  logout_urls   = var.frontend_logout_urls

  # Token validity — 60 min access/id, 30 day refresh
  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  # Supported identity providers
  supported_identity_providers = ["COGNITO"]

  # No secret for SPA
  generate_secret = false

  # Explicit token revocation
  enable_token_revocation = true

  # Read and write attributes
  read_attributes  = ["email", "email_verified", "custom:role"]
  write_attributes = ["email", "custom:role"]
}

# -----------------------------------------------------------------------------
# Initial Admin User (Conditional)
# Lifecycle ignores password and attribute changes after creation
# -----------------------------------------------------------------------------

resource "aws_cognito_user" "admin" {
  count = var.create_admin_user ? 1 : 0

  user_pool_id = aws_cognito_user_pool.main.id
  username     = var.admin_email

  attributes = {
    email          = var.admin_email
    email_verified = true
  }

  temporary_password = var.admin_temporary_password

  lifecycle {
    ignore_changes = [
      temporary_password,
      attributes
    ]
  }
}
