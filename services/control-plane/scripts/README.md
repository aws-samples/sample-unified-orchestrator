# Backend Scripts

This directory contains scripts used by the backend application.

## Files

### standalone_noise_filter.py

Bridge module that allows `setup.sh` to use the noise filtering functionality without loading the full Flask application.

**Purpose:**
- Imports `NoiseFilter` and `PublisherNormalizer` from `app.utils.noise_filter`
- Provides a lightweight interface for the setup script
- Avoids Flask app initialization and environment variable requirements during data loading

**Used by:**
- `scripts/setup.sh` - During application data loading to filter out OS-level components

**How it works:**
1. Adjusts Python path to include the backend directory
2. Imports the noise filter utilities
3. Exposes them as `NoiseFilterService` for backward compatibility

## Subdirectories

### utils/

Contains utility scripts for testing, debugging, and analysis. See [utils/README.md](utils/README.md) for details.

## Notes

- Scripts in this directory are part of the application infrastructure
- They should not be confused with the root-level `scripts/` directory which contains setup/deployment scripts
