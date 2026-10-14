# Backend Utility Scripts

This directory contains utility scripts for testing, debugging, and analysis.

## Scripts

### Assessment Analysis

- **compare_assessments.py** - Compare the last 2 risk assessments for an application to see the impact of changes (e.g., noise filtering)
  ```bash
  cd backend
  source venv/bin/activate
  python scripts/utils/compare_assessments.py
  ```

- **list_assessments.py** - List all risk assessments for an application with component counts and changes over time
  ```bash
  cd backend
  source venv/bin/activate
  python scripts/utils/list_assessments.py
  ```

- **inspect_assessment.py** - Inspect the structure and contents of a risk assessment file
  ```bash
  cd backend
  source venv/bin/activate
  python scripts/utils/inspect_assessment.py
  ```

### Integration Testing

- **test_integration.py** - Test the noise filtering integration by checking component distribution across tables
  ```bash
  cd backend
  source venv/bin/activate
  python scripts/utils/test_integration.py
  ```

## Usage

All scripts should be run from the `backend` directory with the virtual environment activated:

```bash
cd backend
source venv/bin/activate
python scripts/utils/<script_name>.py
```

## Environment Requirements

- AWS credentials configured
- `.env` file with required environment variables:
  - `AWS_REGION`
  - `S3_UNO_DP_BUCKET`
- Virtual environment with dependencies installed

## Notes

- These scripts are for development and debugging purposes
- They directly access DynamoDB and S3 resources
- Make sure you're pointing to the correct environment (dev/prod)
