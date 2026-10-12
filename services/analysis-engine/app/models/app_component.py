"""Application component data model."""
from dataclasses import dataclass
from typing import Optional, Dict, Any


@dataclass
class AppComponent:
    component_id: str
    application_id: str
    application_name: str = ''
    software_publisher: str = ''
    product: str = ''
    normalized_version: str = ''
    full_version: str = ''
    is_licensable: bool = False
    type: str = 'standard'
    eosl_status: str = ''
    eosl_date: str = ''
    obsolete_date: str = ''
    category: str = ''
    sub_category: str = ''
    computer_name: str = ''
    host_server: str = ''
    device_category: str = ''

    def to_dict(self) -> Dict[str, Any]:
        return {
            'component_id': self.component_id, 'application_id': self.application_id,
            'application_name': self.application_name, 'software_publisher': self.software_publisher,
            'product': self.product, 'normalized_version': self.normalized_version,
            'full_version': self.full_version, 'is_licensable': self.is_licensable,
            'type': self.type, 'eosl_status': self.eosl_status, 'eosl_date': self.eosl_date,
            'obsolete_date': self.obsolete_date, 'category': self.category,
            'sub_category': self.sub_category, 'computer_name': self.computer_name,
            'host_server': self.host_server, 'device_category': self.device_category,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'AppComponent':
        return cls(**{k: data.get(k, '') for k in cls.__dataclass_fields__})
