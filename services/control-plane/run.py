"""Application entry point.

Production usage:
    gunicorn run:app -k uvicorn.workers.UvicornWorker
"""
import os

from dotenv import load_dotenv

# Load environment variables from .env file
env_file = os.getenv("ENV_FILE", ".env")

if os.path.exists(env_file):
    print(f"Loading environment from: {env_file}")
    load_dotenv(env_file)
else:
    print(f"Warning: {env_file} not found")
    load_dotenv()  # Try default .env

# Remove empty AWS_PROFILE to prevent boto3 ProfileNotFound
if os.environ.get('AWS_PROFILE', None) == '':
    del os.environ['AWS_PROFILE']

from app import create_app  # noqa: E402 — must come after dotenv

app = create_app()

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("APP_HOST", "127.0.0.1")
    is_dev = os.getenv("APP_ENV", "development") == "development"

    uvicorn.run("run:app", host=host, port=port, reload=is_dev)
