# Docker Configuration for Backend

Multi-stage, multi-architecture Docker setup for the Unified Orchestrator backend.

## Features

- **Multi-stage build**: Optimized image size
- **Multi-architecture**: Supports both AMD64 and ARM64
- **Security**: Non-root user, minimal base image
- **WSGI server**: Gunicorn for serving the application (review and harden before production)
- **Health checks**: Built-in container health monitoring
- **Best practices**: Layer caching, .dockerignore, minimal dependencies

## Architecture Support

The Dockerfile supports both:
- `linux/amd64` (x86_64) - Intel/AMD processors
- `linux/arm64` (aarch64) - ARM processors (AWS Graviton, Apple Silicon)

## Build Options

### Option 1: GitHub Actions (Recommended - No Local Docker)

Push your code to GitHub and the workflow automatically builds and pushes multi-arch images.

```bash
git add .
git commit -m "Deploy backend"
git push origin main
```

The workflow runs on:
- Push to `main` or `develop` branches
- Pull requests
- Manual trigger via GitHub Actions UI

### Option 2: AWS CodeBuild (No Local Docker)

Use the provided script to build via AWS CodeBuild:

```bash
cd ../../infrastructure/scripts
chmod +x build-and-push-image.sh
./build-and-push-image.sh --environment dev --tag v1.0.0
```

This script:
1. Packages your source code
2. Uploads to S3
3. Triggers CodeBuild
4. Monitors build progress
5. Pushes to ECR

### Option 3: Cloud Instance (EC2/Cloud9)

Launch an EC2 instance or Cloud9 environment and run:

```bash
# Install Docker (if not already installed)
sudo yum update -y
sudo yum install -y docker
sudo service docker start
sudo usermod -a -G docker ec2-user

# Clone your repository
git clone <your-repo-url>
cd unified-orchestrator

# Run build script
cd infrastructure/scripts
chmod +x build-multiarch-cloud.sh
./build-multiarch-cloud.sh --environment dev --tag v1.0.0
```

### Option 4: Local Docker (If Available)

If you have Docker installed locally:

```bash
# Set up buildx
docker buildx create --name multiarch-builder --use
docker buildx inspect --bootstrap

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build and push
cd backend
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file docker/Dockerfile \
  --tag <account-id>.dkr.ecr.us-east-1.amazonaws.com/unified-orchestrator-backend:latest \
  --push \
  .
```

## Dockerfile Stages

### Stage 1: Base
- Python 3.12 slim image
- System dependencies (gcc, g++, libpq-dev)
- Environment variables

### Stage 2: Builder
- Creates virtual environment
- Installs Python dependencies
- Optimized for caching

### Stage 3: Runtime
- Minimal runtime image
- Copies only virtual environment
- Non-root user (appuser)
- Health check configuration
- Gunicorn production server

## Environment Variables

The container accepts these environment variables:

```bash
# Application Configuration
APP_ENV=production            # "production" or "development"
PORT=5000                     # Application port

# AWS Configuration
AWS_REGION=us-east-1          # AWS region
AWS_ACCESS_KEY_ID=<key>       # AWS credentials (or use IAM role)
AWS_SECRET_ACCESS_KEY=<secret>

# Database
DYNAMODB_ENDPOINT=            # Leave empty for AWS DynamoDB
REDIS_URL=redis://redis:6379  # Redis connection

# Authentication
COGNITO_USER_POOL_ID=<pool-id>
COGNITO_APP_CLIENT_ID=<client-id>

# Application
CORS_ORIGINS=http://localhost:3000
```

## Running Locally

### Using Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "5000:5000"
    environment:
      - APP_ENV=development
      - AWS_REGION=us-east-1
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    volumes:
      - ./app:/app/app  # For development hot-reload

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

Run:
```bash
docker-compose up
```

### Using Docker Run

```bash
docker run -d \
  --name backend \
  -p 5000:5000 \
  -e APP_ENV=production \
  -e AWS_REGION=us-east-1 \
  -e REDIS_URL=redis://redis:6379 \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/unified-orchestrator-backend:latest
```

## Health Check

The container includes a health check that runs every 30 seconds:

```bash
# Check container health
docker ps

# View health check logs
docker inspect --format='{{json .State.Health}}' <container-id>
```

The health endpoint is: `http://localhost:5000/health`

## Image Size Optimization

The multi-stage build reduces image size by:
- Using slim base images
- Installing only runtime dependencies
- Removing build tools from final image
- Using .dockerignore to exclude unnecessary files

Typical image sizes:
- AMD64: ~200-250 MB
- ARM64: ~200-250 MB

## Security Features

1. **Non-root user**: Runs as `appuser` (UID 1000)
2. **Minimal base**: Python slim image with minimal packages
3. **No secrets in image**: All secrets via environment variables
4. **Image scanning**: Automatic vulnerability scanning in ECR
5. **Read-only filesystem**: Application doesn't write to disk

## Troubleshooting

### Build Fails

```bash
# Check Docker version
docker version

# Check buildx
docker buildx version

# Clean build cache
docker buildx prune -a
```

### Container Won't Start

```bash
# View logs
docker logs <container-id>

# Check health
docker inspect <container-id>

# Interactive shell
docker exec -it <container-id> /bin/bash
```

### Multi-arch Issues

```bash
# Install QEMU
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes

# Verify platforms
docker buildx ls
```

## Best Practices

1. **Tag images properly**: Use semantic versioning
2. **Scan for vulnerabilities**: Enable ECR scanning
3. **Use specific base image versions**: Avoid `latest` tag
4. **Minimize layers**: Combine RUN commands
5. **Use .dockerignore**: Exclude unnecessary files
6. **Set resource limits**: Configure memory and CPU limits
7. **Monitor logs**: Use CloudWatch or similar
8. **Regular updates**: Keep base images and dependencies updated

## CI/CD Integration

The GitHub Actions workflow automatically:
- Builds on every push to main/develop
- Creates multi-arch images
- Scans for vulnerabilities
- Pushes to ECR
- Tags with commit SHA and environment

## Next Steps

After building the image:

1. Deploy to ECS Fargate or EC2
2. Configure load balancer
3. Set up auto-scaling
4. Configure monitoring and alerts
5. Implement blue-green deployments

## Resources

- [Docker Multi-platform Builds](https://docs.docker.com/build/building/multi-platform/)
- [AWS ECR Documentation](https://docs.aws.amazon.com/ecr/)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Gunicorn Configuration](https://docs.gunicorn.org/en/stable/settings.html)
