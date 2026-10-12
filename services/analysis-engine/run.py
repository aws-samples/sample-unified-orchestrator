"""Application entry point."""
import logging
import os
from dotenv import load_dotenv

# Configure root logger early so all loggers (including uno_auth.*) emit to stdout
log_level = os.getenv('LOG_LEVEL', 'INFO')
logging.basicConfig(
    level=getattr(logging, log_level.upper(), logging.INFO),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    force=True,
)

# Remove empty AWS_PROFILE to prevent boto3 ProfileNotFound on ECS
if os.environ.get('AWS_PROFILE', None) == '':
    del os.environ['AWS_PROFILE']

env_file = os.getenv('ENV_FILE', '.env')
if os.path.exists(env_file):
    print(f"Loading environment from: {env_file}")
    load_dotenv(env_file)
else:
    print(f"Warning: {env_file} not found")
    load_dotenv()

from app.main import create_app
from app.config import Config

env = os.getenv('APP_ENV', 'development')
app = create_app(env)

if Config.USE_AWS_PROFILE:
    print(f"AWS Credentials: Using profile '{Config.AWS_PROFILE}' (local development)")
else:
    print("AWS Credentials: Using ECS task role / default credential chain (production)")

if __name__ == '__main__':
    import uvicorn

    port = int(os.getenv('PORT', 8080))
    host = os.getenv('HOST', '127.0.0.1')
    debug = env == 'development'

    if debug:
        print(f"Starting uvicorn on {host}:{port} in DEBUG mode with auto-reload")
        uvicorn.run(
            "run:app",
            host=host,
            port=port,
            reload=True,
            log_level="info"
        )
    else:
        print(f"Starting uvicorn on {host}:{port} in PRODUCTION mode")
        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level="info"
        )
