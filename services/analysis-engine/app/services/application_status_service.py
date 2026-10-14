"""Application Status Service for managing lifecycle status transitions."""
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
import logging

from app.models.application import ApplicationStatus
from app.repositories.application_repository import ApplicationRepository

logger = logging.getLogger(__name__)


class ApplicationStatusService:
    """Service for managing application lifecycle status transitions."""

    def __init__(self):
        self.application_repo = ApplicationRepository()

    def update_risk_assessment_status(
        self,
        application_id: str,
        status: str
    ) -> Dict[str, Any]:
        """Update risk assessment status."""
        valid_statuses = [
            ApplicationStatus.RISK_NOT_STARTED,
            ApplicationStatus.RISK_IN_PROGRESS,
            ApplicationStatus.RISK_COMPLETED
        ]
        if status not in valid_statuses:
            raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")

        timestamp = int(datetime.now().timestamp())
        updates = {
            'risk_assessment_status': status,
            'updated_at': timestamp
        }

        if status == ApplicationStatus.RISK_IN_PROGRESS:
            updates['risk_assessment_started_at'] = timestamp
        elif status == ApplicationStatus.RISK_COMPLETED:
            updates['risk_assessment_completed_at'] = timestamp

        return self.application_repo.update(application_id, updates)

    def update_wave_analysis_status(
        self,
        application_id: str,
        status: str
    ) -> Dict[str, Any]:
        """Update wave analysis status."""
        valid_statuses = [
            ApplicationStatus.WAVE_NOT_STARTED,
            ApplicationStatus.WAVE_IN_PROGRESS,
            ApplicationStatus.WAVE_COMPLETED
        ]
        if status not in valid_statuses:
            raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")

        timestamp = int(datetime.now().timestamp())
        updates = {
            'wave_analysis_status': status,
            'updated_at': timestamp
        }

        if status == ApplicationStatus.WAVE_IN_PROGRESS:
            updates['wave_analysis_started_at'] = timestamp
        elif status == ApplicationStatus.WAVE_COMPLETED:
            updates['wave_analysis_completed_at'] = timestamp

        return self.application_repo.update(application_id, updates)

    def update_atx_mapping_status(
        self,
        application_id: str,
        status: str
    ) -> Dict[str, Any]:
        """Update ATX mapping status."""
        valid_statuses = [
            ApplicationStatus.ATX_NOT_MAPPED,
            ApplicationStatus.ATX_MAPPED,
            ApplicationStatus.ATX_COMPLETED
        ]
        if status not in valid_statuses:
            raise ValueError(f"Invalid status: {status}. Must be one of {valid_statuses}")

        timestamp = int(datetime.now().timestamp())
        updates = {
            'atx_mapping_status': status,
            'updated_at': timestamp
        }

        if status == ApplicationStatus.ATX_MAPPED:
            updates['atx_mapping_assigned_at'] = timestamp
        elif status == ApplicationStatus.ATX_COMPLETED:
            updates['atx_mapping_completed_at'] = timestamp

        return self.application_repo.update(application_id, updates)

    def clear_atx_mapping(self, application_id: str) -> Dict[str, Any]:
        """Clear ATX mapping and reset wave analysis status."""
        timestamp = int(datetime.now().timestamp())
        updates = {
            'atx_mapping_status': ApplicationStatus.ATX_NOT_MAPPED,
            'wave_analysis_status': ApplicationStatus.WAVE_NOT_STARTED,
            'atx_mapping_assigned_at': None,
            'wave_analysis_started_at': None,
            'wave_analysis_completed_at': None,
            'updated_at': timestamp
        }

        return self.application_repo.update(application_id, updates)

    def reset_completed_application(self, application_id: str) -> Dict[str, Any]:
        """Reset completed application to allow re-analysis."""
        timestamp = int(datetime.now().timestamp())
        updates = {
            'risk_assessment_status': ApplicationStatus.RISK_NOT_STARTED,
            'wave_analysis_status': ApplicationStatus.WAVE_NOT_STARTED,
            'atx_mapping_status': ApplicationStatus.ATX_NOT_MAPPED,
            'risk_assessment_started_at': None,
            'risk_assessment_completed_at': None,
            'wave_analysis_started_at': None,
            'wave_analysis_completed_at': None,
            'atx_mapping_assigned_at': None,
            'atx_mapping_completed_at': None,
            'updated_at': timestamp
        }

        return self.application_repo.update(application_id, updates)

    def can_run_wave_analysis(self, application_id: str) -> Tuple[bool, Optional[str]]:
        """Check if application can be included in wave analysis."""
        app = self.application_repo.get(application_id)

        if not app:
            return False, "Application not found"

        # Must have risk assessment IN_PROGRESS or COMPLETED
        risk_status = app.get('risk_assessment_status')
        if risk_status not in [ApplicationStatus.RISK_IN_PROGRESS, ApplicationStatus.RISK_COMPLETED]:
            return False, "Risk assessment not started"

        # Must not have completed wave analysis
        if app.get('wave_analysis_status') == ApplicationStatus.WAVE_COMPLETED:
            return False, "Wave analysis already completed"

        # Must not have completed ATX mapping
        if app.get('atx_mapping_status') == ApplicationStatus.ATX_COMPLETED:
            return False, "ATX mapping already completed"

        return True, None

    def get_applications_for_wave_analysis(self, wave_id: str) -> List[Dict[str, Any]]:
        """Get applications eligible for wave analysis."""
        all_apps = self.application_repo.get_by_wave(wave_id)

        eligible_apps = []
        for app in all_apps:
            can_analyze, _ = self.can_run_wave_analysis(app['application_id'])
            if can_analyze:
                eligible_apps.append(app)

        return eligible_apps

    def get_applications_for_atx_mapping(self, wave_id: str) -> List[Dict[str, Any]]:
        """Get applications eligible for ATX mapping."""
        all_apps = self.application_repo.get_by_wave(wave_id)

        eligible_apps = []
        for app in all_apps:
            # Must have completed wave analysis
            if app.get('wave_analysis_status') != ApplicationStatus.WAVE_COMPLETED:
                continue

            # Must not have completed ATX mapping
            if app.get('atx_mapping_status') == ApplicationStatus.ATX_COMPLETED:
                continue

            eligible_apps.append(app)

        return eligible_apps

    def bulk_clear_atx_mappings(
        self,
        application_ids: List[str]
    ) -> Dict[str, Any]:
        """Clear ATX mappings for multiple applications."""
        results = {
            'success_count': 0,
            'failed_count': 0,
            'errors': []
        }

        for app_id in application_ids:
            try:
                self.clear_atx_mapping(app_id)
                results['success_count'] += 1
            except Exception as e:
                results['failed_count'] += 1
                results['errors'].append({
                    'application_id': app_id,
                    'error': str(e)
                })
                logger.error(f"Failed to clear ATX mapping for {app_id}: {e}")

        return results

    def bulk_mark_complete(
        self,
        application_ids: List[str]
    ) -> Dict[str, Any]:
        """Mark multiple applications as complete."""
        results = {
            'success_count': 0,
            'failed_count': 0,
            'errors': []
        }

        for app_id in application_ids:
            try:
                self.update_atx_mapping_status(app_id, ApplicationStatus.ATX_COMPLETED)
                results['success_count'] += 1
            except Exception as e:
                results['failed_count'] += 1
                results['errors'].append({
                    'application_id': app_id,
                    'error': str(e)
                })
                logger.error(f"Failed to mark {app_id} as complete: {e}")

        return results

    def bulk_reset_applications(
        self,
        application_ids: List[str]
    ) -> Dict[str, Any]:
        """Reset multiple completed applications."""
        results = {
            'success_count': 0,
            'failed_count': 0,
            'errors': []
        }

        for app_id in application_ids:
            try:
                self.reset_completed_application(app_id)
                results['success_count'] += 1
            except Exception as e:
                results['failed_count'] += 1
                results['errors'].append({
                    'application_id': app_id,
                    'error': str(e)
                })
                logger.error(f"Failed to reset {app_id}: {e}")

        return results

    def get_status_summary(self, wave_id: str) -> Dict[str, Any]:
        """Get status summary for a wave."""
        all_apps = self.application_repo.get_by_wave(wave_id)

        summary = {
            'wave_id': wave_id,
            'total_applications': len(all_apps),
            'onboarding': {},
            'risk_assessment': {},
            'wave_analysis': {},
            'atx_mapping': {}
        }

        # Count by status
        for app in all_apps:
            # Onboarding
            onboarding_status = app.get('onboarding_status', ApplicationStatus.ONBOARDING_PENDING)
            summary['onboarding'][onboarding_status] = summary['onboarding'].get(onboarding_status, 0) + 1

            # Risk assessment
            risk_status = app.get('risk_assessment_status', ApplicationStatus.RISK_NOT_STARTED)
            summary['risk_assessment'][risk_status] = summary['risk_assessment'].get(risk_status, 0) + 1

            # Wave analysis
            wave_status = app.get('wave_analysis_status', ApplicationStatus.WAVE_NOT_STARTED)
            summary['wave_analysis'][wave_status] = summary['wave_analysis'].get(wave_status, 0) + 1

            # ATX mapping
            atx_status = app.get('atx_mapping_status', ApplicationStatus.ATX_NOT_MAPPED)
            summary['atx_mapping'][atx_status] = summary['atx_mapping'].get(atx_status, 0) + 1

        return summary
