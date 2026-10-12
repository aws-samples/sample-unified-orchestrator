"""Repository for application components."""
import logging
from typing import List
from app.models.app_component import AppComponent
from app.config import Config

logger = logging.getLogger(__name__)


class AppComponentRepository:
    def __init__(self):
        self._dynamodb = None
        self.table_name = Config.APP_COMPONENTS_TABLE
        self._table = None

    @property
    def dynamodb(self):
        if self._dynamodb is None:
            self._dynamodb = Config.get_boto3_resource('dynamodb')
        return self._dynamodb

    @property
    def table(self):
        if self._table is None:
            self._table = self.dynamodb.Table(self.table_name)
        return self._table

    def get_by_application_id(self, application_id: str) -> List[AppComponent]:
        from boto3.dynamodb.conditions import Key
        response = self.table.query(
            IndexName='application_id_index',
            KeyConditionExpression=Key('application_id').eq(application_id)
        )

        def _item_to_component(item):
            return AppComponent.from_dict({
                'component_id': item.get('component_id', ''),
                'application_id': item.get('application_id', ''),
                'application_name': item.get('application_name', ''),
                'software_publisher': item.get('software_publisher', ''),
                'product': item.get('product', ''),
                'normalized_version': item.get('normalized_version', ''),
                'full_version': item.get('full_version', ''),
                'is_licensable': item.get('is_licensable', False),
                'type': item.get('type', 'standard'),
                'eosl_status': item.get('eosl_status', ''),
                'eosl_date': item.get('eosl_date', ''),
                'obsolete_date': item.get('obsolete_date', ''),
                'category': item.get('category', ''),
                'sub_category': item.get('sub_category', ''),
                'computer_name': item.get('computer_name', ''),
                'host_server': item.get('host_server', ''),
                'device_category': item.get('device_category', ''),
            })

        components = [_item_to_component(item) for item in response.get('Items', [])]
        while 'LastEvaluatedKey' in response:
            response = self.table.query(
                IndexName='application_id_index',
                KeyConditionExpression=Key('application_id').eq(application_id),
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            components.extend([_item_to_component(item) for item in response.get('Items', [])])
        return components
