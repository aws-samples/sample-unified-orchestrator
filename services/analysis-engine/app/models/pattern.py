"""Pattern data model."""
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum


class PatternType(Enum):
    UPGRADE = "upgrade"
    MODERNIZE = "modernize"
    NO_CHANGE = "no_change"
    GENERIC_MIGRATE = "generic_migrate"


class ComplexityLevel(Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ConfidenceLevel(Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


@dataclass
class Pattern:
    pattern_id: str
    pattern_type: str
    wave_id: str
    confidence_score: float
    affected_applications: List[str]
    pattern_description: str
    recommendations: List[str]
    pattern_subtype: Optional[str] = None
    transformations: Optional[List[str]] = field(default_factory=list)
    complexity_level: Optional[str] = None
    detected_at: Optional[int] = None
    metadata: Optional[Dict[str, Any]] = field(default_factory=dict)
    atx_name: Optional[str] = None
    atx_description: Optional[str] = None
    application_id: Optional[str] = None
    application_name: Optional[str] = None
    strategy: Optional[str] = None
    transformation_instructions: Optional[str] = None

    def __post_init__(self):
        if self.detected_at is None:
            self.detected_at = int(datetime.now().timestamp())
        if not 0.0 <= self.confidence_score <= 1.0:
            raise ValueError(f"Confidence score must be between 0 and 1, got {self.confidence_score}")
        valid_types = [pt.value for pt in PatternType]
        if self.pattern_type not in valid_types:
            raise ValueError(f"Invalid pattern type: {self.pattern_type}")
        if self.complexity_level:
            valid_complexity = [cl.value for cl in ComplexityLevel]
            if self.complexity_level not in valid_complexity:
                raise ValueError(f"Invalid complexity level: {self.complexity_level}")
        if self.transformations is None:
            self.transformations = []

    @property
    def confidence_level(self) -> str:
        if self.confidence_score >= 0.8:
            return ConfidenceLevel.HIGH.value
        elif self.confidence_score >= 0.5:
            return ConfidenceLevel.MEDIUM.value
        return ConfidenceLevel.LOW.value

    @property
    def affected_apps_count(self) -> int:
        return len(self.affected_applications)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'pattern_id': self.pattern_id, 'pattern_type': self.pattern_type,
            'pattern_subtype': self.pattern_subtype, 'transformations': self.transformations or [],
            'wave_id': self.wave_id, 'confidence_score': self.confidence_score,
            'confidence_level': self.confidence_level, 'complexity_level': self.complexity_level,
            'affected_applications': self.affected_applications,
            'affected_apps_count': self.affected_apps_count,
            'pattern_description': self.pattern_description, 'recommendations': self.recommendations,
            'detected_at': self.detected_at, 'metadata': self.metadata or {},
            'atx_name': self.atx_name, 'atx_description': self.atx_description,
            'application_id': self.application_id, 'application_name': self.application_name,
            'strategy': self.strategy, 'transformation_instructions': self.transformation_instructions
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Pattern':
        return cls(
            pattern_id=data['pattern_id'], pattern_type=data['pattern_type'],
            wave_id=data['wave_id'], confidence_score=data['confidence_score'],
            affected_applications=data['affected_applications'],
            pattern_description=data['pattern_description'],
            recommendations=data['recommendations'],
            pattern_subtype=data.get('pattern_subtype'),
            transformations=data.get('transformations', []),
            complexity_level=data.get('complexity_level'),
            detected_at=data.get('detected_at'), metadata=data.get('metadata', {}),
            atx_name=data.get('atx_name'), atx_description=data.get('atx_description'),
            application_id=data.get('application_id'), application_name=data.get('application_name'),
            strategy=data.get('strategy'),
            transformation_instructions=data.get('transformation_instructions')
        )
