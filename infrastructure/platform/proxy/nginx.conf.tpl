#!/bin/bash
set -euxo pipefail

# Proxy config parsed by Terraform from SSM JSON
HTTP_PROXY_URL="${http_proxy_url}"
HTTPS_PROXY_URL="${https_proxy_url}"
NO_PROXY_LIST="${no_proxy_list}"

export HTTP_PROXY="$HTTP_PROXY_URL"
export HTTPS_PROXY="$HTTPS_PROXY_URL"
export NO_PROXY="$NO_PROXY_LIST"
export http_proxy="$HTTP_PROXY_URL"
export https_proxy="$HTTPS_PROXY_URL"
export no_proxy="$NO_PROXY_LIST"

# Persist proxy config for future sessions
cat > /etc/profile.d/proxy.sh <<EOF
export HTTP_PROXY=$HTTP_PROXY_URL
export HTTPS_PROXY=$HTTPS_PROXY_URL
export NO_PROXY=$NO_PROXY_LIST
export http_proxy=$HTTP_PROXY_URL
export https_proxy=$HTTPS_PROXY_URL
export no_proxy=$NO_PROXY_LIST
EOF

# Install Nginx and socat (uses proxy for package download)
if [ -n "$HTTP_PROXY_URL" ]; then
  echo "proxy=$HTTP_PROXY_URL" >> /etc/dnf/dnf.conf
fi

dnf install -y nginx socat

# Parse proxy host:port for socat PROXY connect
PROXY_HOST=$(echo "$HTTP_PROXY_URL" | sed -E 's|https?://||' | cut -d: -f1)
PROXY_PORT=$(echo "$HTTP_PROXY_URL" | sed -E 's|https?://||' | cut -d: -f2)

# Start socat tunnel: localhost:8443 -> corporate proxy -> Cognito HTTPS
# socat doesn't use env vars, so we route through the HTTP CONNECT proxy explicitly
if [ -n "$PROXY_HOST" ] && [ -n "$PROXY_PORT" ]; then
  SOCAT_CMD="/usr/bin/socat TCP-LISTEN:8443,fork,reuseaddr PROXY:$PROXY_HOST:${cognito_domain}:443,proxyport=$PROXY_PORT"
else
  # Fallback: direct connection (for VPCs with internet access)
  SOCAT_CMD="/usr/bin/socat TCP-LISTEN:8443,fork,reuseaddr OPENSSL:${cognito_domain}:443,verify=1"
fi

cat > /etc/systemd/system/socat-cognito.service <<SOCAT_UNIT
[Unit]
Description=socat tunnel to Cognito via corporate proxy
After=network.target

[Service]
ExecStart=$SOCAT_CMD
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SOCAT_UNIT

systemctl daemon-reload
systemctl enable --now socat-cognito

# Configure SSM agent to use proxy via systemd override
mkdir -p /etc/systemd/system/amazon-ssm-agent.service.d
cat > /etc/systemd/system/amazon-ssm-agent.service.d/proxy.conf <<SSMPROXY
[Service]
Environment="HTTP_PROXY=$HTTP_PROXY_URL"
Environment="HTTPS_PROXY=$HTTPS_PROXY_URL"
Environment="NO_PROXY=$NO_PROXY_LIST"
Environment="http_proxy=$HTTP_PROXY_URL"
Environment="https_proxy=$HTTPS_PROXY_URL"
Environment="no_proxy=$NO_PROXY_LIST"
SSMPROXY

systemctl daemon-reload
systemctl restart amazon-ssm-agent

# Write Nginx configuration
cat > /etc/nginx/conf.d/uno-proxy.conf <<NGINX_CONF
server {
    listen 80;
    server_name ${control_plane_domain};

    # Health check
    location /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }

    # Cognito Auth via socat tunnel (routed through corporate proxy)
    location /auth/ {
        rewrite ^/auth/(.*) /\$1 break;
        proxy_pass https://localhost:8443/;
        proxy_set_header Host ${cognito_domain};
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-bundle.crt;
        proxy_ssl_name ${cognito_domain};
    }

    # Static assets — proxy to S3 with cache headers
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        rewrite ^/(.*) /\$1 break;
        proxy_pass https://${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        proxy_set_header Host ${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-bundle.crt;
        proxy_ssl_name ${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA — proxy to S3, fallback to index.html for client-side routing
    location / {
        rewrite ^/(.*) /\$1 break;
        proxy_pass https://${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        proxy_set_header Host ${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-bundle.crt;
        proxy_ssl_name ${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        proxy_intercept_errors on;
        error_page 403 404 = @spa_fallback;
    }

    # SPA fallback — serve index.html from S3 for any unknown route
    location @spa_fallback {
        set \$s3_fallback https://${frontend_bucket_name}.s3.${aws_region}.amazonaws.com/index.html;
        proxy_pass \$s3_fallback;
        proxy_set_header Host ${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-bundle.crt;
        proxy_ssl_name ${frontend_bucket_name}.s3.${aws_region}.amazonaws.com;
    }
}
NGINX_CONF

# Remove default server block to avoid conflicts
rm -f /etc/nginx/conf.d/default.conf

# Enable and start Nginx
systemctl enable nginx
systemctl start nginx
