#!/bin/sh
# =============================================================================
# Common Git Configuration for Code AWS
# Sets up HTTPS authentication using CODE_AWS_TOKEN
# =============================================================================

set -e

if [ -z "$CODE_AWS_TOKEN" ]; then
  echo "❌ ERROR: CODE_AWS_TOKEN environment variable is not set"
  exit 1
fi

echo "🔧 Configuring Git for Code AWS..."

export GIT_CONFIG_COUNT=2
export GIT_CONFIG_KEY_0="url.https://oauth2:${CODE_AWS_TOKEN}@code.aws.dev/.insteadOf"
export GIT_CONFIG_VALUE_0="ssh://git@ssh.code.aws.dev/"
export GIT_CONFIG_KEY_1="url.https://oauth2:${CODE_AWS_TOKEN}@code.aws.dev/.insteadOf"
export GIT_CONFIG_VALUE_1="git@ssh.code.aws.dev:"

echo "✅ Git configuration complete"
