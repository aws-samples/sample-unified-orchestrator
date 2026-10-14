"""Repository for target components."""
import logging
from typing import List, Optional, Dict, Any
from app.models.target_component import TargetComponent
from app.config import Config

logger = logging.getLogger(__name__)


class TargetComponentRepository:
    def __init__(self):
        self._dynamodb = None
        self.table_name = Config.TARGET_COMPONENTS_TABLE
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

    def get_by_id(self, component_id: str) -> Optional[TargetComponent]:
        response = self.table.get_item(Key={'component_id': component_id})
        if 'Item' in response:
            return TargetComponent.from_dict(response['Item'])
        return None

    MAX_ITEMS = 10_000

    def get_all(self) -> List[TargetComponent]:
        response = self.table.scan(Limit=1000)
        components = [TargetComponent.from_dict(item) for item in response.get('Items', [])]
        while 'LastEvaluatedKey' in response and len(components) < self.MAX_ITEMS:
            response = self.table.scan(ExclusiveStartKey=response['LastEvaluatedKey'], Limit=1000)
            components.extend([TargetComponent.from_dict(item) for item in response.get('Items', [])])
        return components[:self.MAX_ITEMS]

    _PROJECTION_FIELDS = [
        'component_id', 'publisher', 'product_key', 'full_version',
        'edition', 'software_title', 'end_of_life_date', 'end_of_support_date',
        'application_name'
    ]
    _PROJECTION_EXPRESSION = ', '.join(_PROJECTION_FIELDS)

    def _query_all_pages(self, application_name: str, projection: bool = False) -> List[TargetComponent]:
        from boto3.dynamodb.conditions import Key
        kwargs = {
            'IndexName': 'application_name_index',
            'KeyConditionExpression': Key('application_name').eq(application_name),
        }
        if projection:
            kwargs['ProjectionExpression'] = self._PROJECTION_EXPRESSION
        components = []
        response = self.table.query(**kwargs)
        components.extend([TargetComponent.from_dict(item) for item in response.get('Items', [])])
        while 'LastEvaluatedKey' in response:
            kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = self.table.query(**kwargs)
            components.extend([TargetComponent.from_dict(item) for item in response.get('Items', [])])
        return components

    def get_by_application(self, application_name: str, projection: bool = True) -> List[TargetComponent]:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import time
        start = time.time()
        if application_name == 'ALL':
            components = self._query_all_pages('ALL', projection=projection)
            return components
        results = {}
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {
                executor.submit(self._query_all_pages, application_name, projection): 'app',
                executor.submit(self._query_all_pages, 'ALL', projection): 'global',
            }
            for future in as_completed(futures):
                results[futures[future]] = future.result()
        return results.get('app', []) + results.get('global', [])
