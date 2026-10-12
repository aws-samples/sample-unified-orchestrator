Content-Type: multipart/mixed; boundary="==BOUNDARY=="
MIME-Version: 1.0

--==BOUNDARY==
Content-Type: text/cloud-config; charset="us-ascii"
MIME-Version: 1.0
Content-Transfer-Encoding: 7bit
Content-Disposition: attachment; filename="cloud-config.txt"

#cloud-config
cloud_final_modules:
- [scripts-user, always]

--==BOUNDARY==


Content-Type: text/x-shellscript; charset="us-ascii"


#!/bin/bash
# ============================================================================
# ECS EC2 Instance User Data
# Configures ECS agent, HTTP/HTTPS proxy, and Docker daemon proxy settings
# ============================================================================

# ECS Agent Configuration
echo ECS_CLUSTER=${ecs_cluster_name} >> /etc/ecs/ecs.config
echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config
echo ECS_ENABLE_TASK_IAM_ROLE=true >> /etc/ecs/ecs.config

# Proxy configuration for ECS agent and Docker
%{ if http_proxy != "" ~}
NO_PROXY_LIST="169.254.169.254,169.254.170.2,localhost,127.0.0.1,.s3.amazonaws.com,.transform-custom.us-east-1.api.aws,.amazonaws.com"
echo "HTTP_PROXY=${http_proxy}" >> /etc/ecs/ecs.config
echo "HTTPS_PROXY=${https_proxy}" >> /etc/ecs/ecs.config
echo "NO_PROXY=$NO_PROXY_LIST" >> /etc/ecs/ecs.config

# Docker daemon proxy configuration
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/http-proxy.conf <<EOF
[Service]
Environment="HTTP_PROXY=${http_proxy}"
Environment="HTTPS_PROXY=${https_proxy}"
Environment="NO_PROXY=$NO_PROXY_LIST"
EOF

systemctl daemon-reload
systemctl restart docker
%{ endif ~}

# Restart ECS agent to pick up configuration
/usr/libexec/amazon-ecs-init pre-start
/usr/libexec/amazon-ecs-init start &
systemctl restart ecs

--==BOUNDARY==--
