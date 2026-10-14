# Multi-stage Dockerfile for FastAPI Backend
# Supports both AMD64 and ARM64 architectures

# Stage 1: Base image with common dependencies
FROM public.ecr.aws/docker/library/python:3.13.3-slim AS base

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Install system dependencies and apply security patches
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: Dependencies builder
FROM base AS builder

WORKDIR /build

# Copy requirements first for better caching
COPY requirements.txt .

# Create virtual environment and install dependencies
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
RUN pip install --upgrade pip setuptools wheel

# Install haf-uno-auth + requirements from a private PyPI registry.
# Pass the authenticated index URL as a build arg:
#   --build-arg CODEARTIFACT_INDEX_URL=<url>
# Uses --index-url (not --extra-index-url) to prevent dependency confusion attacks.
# The registry must proxy public PyPI packages (CodeArtifact does this by default).
# Works with AWS CodeArtifact, JFrog Artifactory, Sonatype Nexus, or any
# PyPI-compatible registry. The URL must include credentials if required.
# Examples:
#   CodeArtifact: https://aws:<token>@<domain>.d.codeartifact.<region>.amazonaws.com/pypi/<repo>/simple/
#   JFrog:        https://<user>:<token>@<host>/artifactory/api/pypi/<repo>/simple/
ARG CODEARTIFACT_INDEX_URL=""
RUN if [ -n "$CODEARTIFACT_INDEX_URL" ]; then \
      pip install --index-url "$CODEARTIFACT_INDEX_URL" -r requirements.txt; \
    else \
      pip install -r requirements.txt; \
    fi

# Stage 3: Runtime image
FROM public.ecr.aws/docker/library/python:3.13.3-slim AS runtime

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    APP_ENV=production \
    PORT=8080

# Install only runtime dependencies and apply security patches
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 appuser

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Set working directory
WORKDIR /app

# Copy application code
COPY --chown=appuser:appuser . .

# Switch to non-root user
USER appuser

# Health check — uses PORT env var so it matches the actual bind port
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE ${PORT}

# Run with gunicorn + uvicorn workers for production
# Shell form so $PORT is expanded at runtime from the environment
CMD gunicorn --bind "0.0.0.0:${PORT}" --workers 2 --worker-class uvicorn.workers.UvicornWorker --timeout 300 --graceful-timeout 30 --keep-alive 5 --access-logfile - --error-logfile - run:app
