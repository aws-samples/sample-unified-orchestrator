"""Application data model."""
from dataclasses import dataclass
from typing import Optional, Dict, Any
from datetime import datetime


class ApplicationStatus:
    ONBOARDING_PENDING = "PENDING"
    ONBOARDING_COMPLETED = "COMPLETED"
    RISK_NOT_STARTED = "NOT_STARTED"
    RISK_IN_PROGRESS = "IN_PROGRESS"
    RISK_COMPLETED = "COMPLETED"
    WAVE_NOT_STARTED = "NOT_STARTED"
    WAVE_IN_PROGRESS = "IN_PROGRESS"
    WAVE_COMPLETED = "COMPLETED"
    ATX_NOT_MAPPED = "NOT_MAPPED"
    ATX_MAPPED = "MAPPED"
    ATX_COMPLETED = "COMPLETED"


@dataclass
class Application:
    app_id: str
    app_name: str
    version: int
    wave_id: Optional[str] = None
    pod_id: Optional[str] = None
    pam_data: Optional[Dict[str, Any]] = None
    snowflake_data: Optional[Dict[str, Any]] = None
    scm_url: Optional[str] = None
    risk_score: Optional[float] = None
    complexity_score: Optional[float] = None
    readiness_score: Optional[float] = None
    onboarding_status: str = ApplicationStatus.ONBOARDING_PENDING
    risk_assessment_status: str = ApplicationStatus.RISK_NOT_STARTED
    wave_analysis_status: str = ApplicationStatus.WAVE_NOT_STARTED
    atx_mapping_status: str = ApplicationStatus.ATX_NOT_MAPPED
    onboarding_completed_at: Optional[int] = None
    risk_assessment_started_at: Optional[int] = None
    risk_assessment_completed_at: Optional[int] = None
    wave_analysis_started_at: Optional[int] = None
    wave_analysis_completed_at: Optional[int] = None
    atx_mapping_assigned_at: Optional[int] = None
    atx_mapping_completed_at: Optional[int] = None
    created_at: Optional[int] = None
    updated_at: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'app_id': self.app_id, 'app_name': self.app_name, 'version': self.version,
            'wave_id': self.wave_id, 'pod_id': self.pod_id,
            'pam_data': self.pam_data or {}, 'snowflake_data': self.snowflake_data or {},
            'scm_url': self.scm_url, 'risk_score': self.risk_score,
            'complexity_score': self.complexity_score, 'readiness_score': self.readiness_score,
            'onboarding_status': self.onboarding_status,
            'risk_assessment_status': self.risk_assessment_status,
            'wave_analysis_status': self.wave_analysis_status,
            'atx_mapping_status': self.atx_mapping_status,
            'onboarding_completed_at': self.onboarding_completed_at,
            'risk_assessment_started_at': self.risk_assessment_started_at,
            'risk_assessment_completed_at': self.risk_assessment_completed_at,
            'wave_analysis_started_at': self.wave_analysis_started_at,
            'wave_analysis_completed_at': self.wave_analysis_completed_at,
            'atx_mapping_assigned_at': self.atx_mapping_assigned_at,
            'atx_mapping_completed_at': self.atx_mapping_completed_at,
            'created_at': self.created_at or int(datetime.now().timestamp()),
            'updated_at': self.updated_at or int(datetime.now().timestamp())
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Application':
        return cls(
            app_id=data['app_id'], app_name=data['app_name'], version=data['version'],
            wave_id=data.get('wave_id'), pod_id=data.get('pod_id'),
            pam_data=data.get('pam_data'), snowflake_data=data.get('snowflake_data'),
            scm_url=data.get('scm_url'), risk_score=data.get('risk_score'),
            complexity_score=data.get('complexity_score'), readiness_score=data.get('readiness_score'),
            onboarding_status=data.get('onboarding_status', ApplicationStatus.ONBOARDING_PENDING),
            risk_assessment_status=data.get('risk_assessment_status', ApplicationStatus.RISK_NOT_STARTED),
            wave_analysis_status=data.get('wave_analysis_status', ApplicationStatus.WAVE_NOT_STARTED),
            atx_mapping_status=data.get('atx_mapping_status', ApplicationStatus.ATX_NOT_MAPPED),
            onboarding_completed_at=data.get('onboarding_completed_at'),
            risk_assessment_started_at=data.get('risk_assessment_started_at'),
            risk_assessment_completed_at=data.get('risk_assessment_completed_at'),
            wave_analysis_started_at=data.get('wave_analysis_started_at'),
            wave_analysis_completed_at=data.get('wave_analysis_completed_at'),
            atx_mapping_assigned_at=data.get('atx_mapping_assigned_at'),
            atx_mapping_completed_at=data.get('atx_mapping_completed_at'),
            created_at=data.get('created_at'), updated_at=data.get('updated_at')
        )
