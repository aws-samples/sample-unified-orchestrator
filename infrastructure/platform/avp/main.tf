# ============================================================================
# AVP (Amazon Verified Permissions) Module
# Creates policy store, schema, and Cedar policies for UNO authorization.
# ============================================================================

resource "aws_verifiedpermissions_policy_store" "this" {
  validation_settings {
    mode = "STRICT"
  }

  description = "UNO platform authorization policy store - ${var.naming_prefix}"
}

resource "aws_verifiedpermissions_schema" "this" {
  policy_store_id = aws_verifiedpermissions_policy_store.this.id

  definition {
    value = file("${path.module}/../cedar/schema.json")
  }
}

resource "aws_verifiedpermissions_policy" "privileged_access" {
  policy_store_id = aws_verifiedpermissions_policy_store.this.id

  definition {
    static {
      description = "Privileged personas: full access (read, write, manage)"
      statement   = file("${path.module}/../cedar/policies/cognito_groups.cedar")
    }
  }

  depends_on = [aws_verifiedpermissions_schema.this]
}

resource "aws_verifiedpermissions_policy" "pod_app_access" {
  policy_store_id = aws_verifiedpermissions_policy_store.this.id

  definition {
    static {
      description = "POD-restricted personas: read-only access"
      statement   = file("${path.module}/../cedar/policies/pod_app_access.cedar")
    }
  }

  depends_on = [aws_verifiedpermissions_schema.this]
}
