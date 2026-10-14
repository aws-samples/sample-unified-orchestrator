"""Target component data model."""
from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class TargetComponent:
    component_id: str
    publisher: str = ''
    product_key: str = ''
    full_version: str = ''
    edition: str = ''
    software_title: str = ''
    end_of_life_date: str = ''
    end_of_support_date: str = ''
    application_name: str = ''
    file_key: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TargetComponent':
        fields = cls.__dataclass_fields__
        return cls(**{k: data.get(k, '') for k in fields})
