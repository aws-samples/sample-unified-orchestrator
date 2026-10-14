# Stage 1: Python build dependencies
FROM public.ecr.aws/docker/library/python:3.13.3-slim AS builder

WORKDIR /app

# Proxy build args (passed from CI/CD pipeline)
ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ARG NO_PROXY=""
ENV http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY}

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create a virtual environment for clean dependency isolation
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Install haf-uno-auth + requirements from a private PyPI registry.
ARG CODEARTIFACT_INDEX_URL=""
COPY requirements.txt .
RUN pip install --no-cache-dir --index-url "$CODEARTIFACT_INDEX_URL" -r requirements.txt

# Stage 2: Final runtime image
FROM public.ecr.aws/docker/library/ubuntu:24.04

WORKDIR /app

# Proxy build args (passed from CI/CD pipeline)
ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ARG NO_PROXY=""
ENV http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    no_proxy=${NO_PROXY}

# ── System dependencies ─────────────────────────────────────────────
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    curl \
    wget \
    unzip \
    git \
    ca-certificates \
    gnupg \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# ── Java (Amazon Corretto 8, 11, 17, 21) ───────────────────────────
RUN wget -O- https://apt.corretto.aws/corretto.key | gpg --dearmor -o /usr/share/keyrings/corretto.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/corretto.gpg] https://apt.corretto.aws stable main" > /etc/apt/sources.list.d/corretto.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    java-1.8.0-amazon-corretto-jdk \
    java-11-amazon-corretto-jdk \
    java-17-amazon-corretto-jdk \
    java-21-amazon-corretto-jdk \
    && rm -rf /var/lib/apt/lists/*

# Default to Java 21 (most common migration target)
ENV JAVA_HOME=/usr/lib/jvm/java-21-amazon-corretto
ENV PATH=$JAVA_HOME/bin:$PATH

# ── Maven 3.9.9 ────────────────────────────────────────────────────
RUN wget -qO /tmp/maven.tar.gz https://archive.apache.org/dist/maven/maven-3/3.9.9/binaries/apache-maven-3.9.9-bin.tar.gz && \
    tar -xzf /tmp/maven.tar.gz -C /opt && \
    ln -s /opt/apache-maven-3.9.9/bin/mvn /usr/local/bin/mvn && \
    rm /tmp/maven.tar.gz

# ── Gradle 8.10.2 ───────────────────────────────────────────────────
RUN wget -qO /tmp/gradle.zip https://services.gradle.org/distributions/gradle-8.10.2-bin.zip && \
    unzip -q /tmp/gradle.zip -d /opt && \
    ln -s /opt/gradle-8.10.2/bin/gradle /usr/local/bin/gradle && \
    rm /tmp/gradle.zip

# ── Python (3.9, 3.10, 3.11, 3.12, 3.13) ──────────────────────────
RUN add-apt-repository ppa:deadsnakes/ppa && apt-get update && apt-get install -y --no-install-recommends \
    python3.9 python3.9-venv python3.9-dev \
    python3.10 python3.10-venv python3.10-dev \
    python3.11 python3.11-venv python3.11-dev \
    python3.12 python3.12-venv python3.12-dev \
    python3.13 python3.13-venv python3.13-dev \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.13 as default and install pip
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.13 1 && \
    python3 -m ensurepip && python3 -m pip install --upgrade pip

# ── Node.js 20 (for npm-based projects) ────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# ── ATX CLI ─────────────────────────────────────────────────────────
RUN curl -fsSL https://transform-cli.awsstatic.com/install.sh | bash && \
    cp -r /root/.local/share/atx /usr/local/share/atx && \
    ln -sf /usr/local/share/atx/*/atx /usr/local/bin/atx && \
    chmod +x /usr/local/bin/atx

# ── Copy Python venv from builder ──────────────────────────────────
COPY --from=builder /opt/venv /opt/venv
# Fix venv python symlink: builder uses /usr/local/bin/python3.13 (debian-slim)
# but runtime uses /usr/bin/python3.13 (ubuntu deadsnakes)
RUN ln -sf /usr/bin/python3.13 /opt/venv/bin/python && \
    ln -sf /usr/bin/python3.13 /opt/venv/bin/python3
ENV PATH=/opt/venv/bin:$PATH

# ── Create non-root user and workspace ─────────────────────────────
RUN useradd -m -u 1001 appuser && \
    mkdir -p /tmp/atx-workspace && \
    chown -R appuser:appuser /tmp/atx-workspace

# ── Copy application code ──────────────────────────────────────────
COPY --chown=appuser:appuser app ./app
COPY --chown=appuser:appuser run.py .

# Switch to non-root user
USER appuser

ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ATX_SHELL_TIMEOUT=36000 \
    ATX_WORKSPACE=/tmp/atx-workspace

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["gunicorn", "run:app", "--bind", "0.0.0.0:8080", "--workers", "4", "--worker-class", "uvicorn.workers.UvicornWorker", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-"]
