"""
Retrieve Reports for Wave Tool

Retrieves all assessment reports in JSON from S3 for a given wave.
"""

import logging
import json
import boto3
import os
from typing import Dict, Any, List
from strands import tool
from app.repositories.application_repository import ApplicationRepository
from app.repositories.risk_assessment_repository import RiskAssessmentRepository

logger = logging.getLogger(__name__)

# Initialize repositories
application_repo = ApplicationRepository()
risk_assessment_repo = RiskAssessmentRepository()


@tool
def retrieve_reports_for_wave(wave_id: str, eligible_app_ids: List[str] = None) -> Dict[str, Any]:
    """
    Retrieve all assessment reports from S3 for applications in a given wave.

    Args:
        wave_id: Wave ID to retrieve reports for
        eligible_app_ids: Optional list of application IDs to filter by (only retrieve these apps)

    Returns:
        Dictionary containing:
        - wave_id: The wave ID
        - applications: List of applications in the wave
        - reports: List of assessment reports from S3
        - total_applications: Count of applications
        - reports_found: Count of reports successfully retrieved
    """
    logger.info(f"Retrieving assessment reports for wave {wave_id}")
    if eligible_app_ids:
        logger.info(f"Filtering to {len(eligible_app_ids)} eligible applications")

    try:
        # Get all applications in the wave
        applications = application_repo.get_applications_by_wave(wave_id)

        if not applications:
            logger.warning(f"No applications found for wave {wave_id}")
            return {
                'wave_id': wave_id,
                'applications': [],
                'reports': [],
                'total_applications': 0,
                'reports_found': 0,
                'error': 'No applications found in this wave'
            }

        # Filter to eligible applications if provided
        if eligible_app_ids:
            applications = [
                app for app in applications
                if (app.get('application_id') or app.get('app_id')) in eligible_app_ids
            ]
            logger.info(f"Filtered to {len(applications)} eligible applications")

        logger.info(f"Found {len(applications)} applications in wave {wave_id}")

        # Initialize S3 client — use the same bucket as risk_service
        from app.config import Config
        s3_client = Config.get_boto3_client('s3')
        try:
            from app.config import Config
            bucket_name = Config.S3_ARA_BUCKET
        except Exception:
            bucket_name = os.getenv('S3_ARA_BUCKET', os.getenv('S3_ASSETS_BUCKET', 'migration-assessment-reports'))

        # Retrieve reports for each application
        reports = []
        app_list = []

        for app in applications:
            app_id = app.get('application_id') or app.get('app_id')
            # Try multiple field names for application name - APPLICATION_NAME is the primary field
            app_name = (
                app.get('APPLICATION_NAME') or      # Primary field (uppercase)
                app.get('application_name') or      # Lowercase variant
                app.get('app_name') or              # Short name
                app.get('ApplicationName') or       # Mixed case
                f"Application {app_id}"             # Fallback
            )

            # Log what we found for debugging
            if app_name.startswith('Application '):
                logger.warning(f"App {app_id}: Using fallback name. Available fields: {list(app.keys())}")
            else:
                logger.info(f"App {app_id}: Found name '{app_name}'")

            app_list.append({
                'app_id': app_id,
                'app_name': app_name
            })

            # Get latest assessment for this application
            try:
                assessments = risk_assessment_repo.get_assessments_by_app(app_id)

                if not assessments:
                    logger.warning(f"No assessments found for application {app_id}")
                    continue

                # Get the latest assessment (assessments are RiskAssessment objects)
                latest_assessment = sorted(
                    assessments,
                    key=lambda x: x.assessment_date,
                    reverse=True
                )[0]

                s3_report_key = latest_assessment.s3_report_key

                if not s3_report_key:
                    logger.warning(f"No S3 report key found for application {app_id}")
                    continue

                # Retrieve report from S3
                response = s3_client.get_object(Bucket=bucket_name, Key=s3_report_key)
                report_data = json.loads(response['Body'].read().decode('utf-8'))

                reports.append({
                    'app_id': app_id,
                    'app_name': app_name,
                    'assessment_id': latest_assessment.assessment_id,
                    'assessment_date': latest_assessment.assessment_date,
                    'report': report_data
                })

                logger.info(f"Retrieved report for application {app_id}")

            except Exception as e:
                logger.error(f"Error retrieving report for application {app_id}: {str(e)}")
                continue

        logger.info(f"Retrieved {len(reports)} reports for wave {wave_id}")

        return {
            'wave_id': wave_id,
            'applications': app_list,
            'reports': reports,
            'total_applications': len(applications),
            'reports_found': len(reports)
        }

    except Exception as e:
        logger.error(f"Error retrieving reports for wave {wave_id}: {str(e)}")
        return {
            'wave_id': wave_id,
            'applications': [],
            'reports': [],
            'total_applications': 0,
            'reports_found': 0,
            'error': str(e)
        }
