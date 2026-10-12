"""Risk assessment data model."""
from dataclasses import dataclass
from typing import Optional


@dataclass
class RiskAssessment:
    assessment_id: str
    app_id: str
    overall_score: float
    risk_level: str
    assessment_date: int
    s3_report_key: str
    wave_id: Optional[str] = None
    s3_bucket: Optional[str] = None

    def to_dict(self):
        d = {
            'assessment_id': self.assessment_id, 'app_id': self.app_id,
            'overall_score': self.overall_score, 'risk_level': self.risk_level,
            'assessment_date': self.assessment_date, 's3_report_key': self.s3_report_key,
            'wave_id': self.wave_id
        }
        if self.s3_bucket:
            d['s3_bucket'] = self.s3_bucket
        return d

    @classmethod
    def from_dict(cls, data):
        return cls(
            assessment_id=data['assessment_id'], app_id=data['app_id'],
            overall_score=float(data['overall_score']), risk_level=data['risk_level'],
            assessment_date=int(data['assessment_date']), s3_report_key=data['s3_report_key'],
            wave_id=data.get('wave_id'),
            s3_bucket=data.get('s3_bucket')
        )
