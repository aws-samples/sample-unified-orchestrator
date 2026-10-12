"""Application repository for DynamoDB operations."""
from typing import Dict, Any, List, Optional
from .dynamodb_repository import DynamoDBRepository


class ApplicationRepository(DynamoDBRepository):
    def __init__(self):
        from app.config import Config
        super().__init__(Config.APPLICATIONS_TABLE)

    MAX_APPLICATIONS = 10_000

    def get_all_applications(self) -> List[Dict[str, Any]]:
        items = []
        last_evaluated_key = None
        scan_kwargs = {'Limit': 1000}
        while True:
            if last_evaluated_key:
                scan_kwargs['ExclusiveStartKey'] = last_evaluated_key
            response = self.table.scan(**scan_kwargs)
            for item in response.get('Items', []):
                normalized = {
                    'application_id': item.get('application_id'),
                    'application_name': item.get('APPLICATION_NAME') or item.get('application_name'),
                    'WAVE': item.get('WAVE', ''),
                    'STATUS': item.get('STATUS') or item.get('status', 'active'),
                    'scm_urls': item.get('scm_urls') or item.get('SCM_URLS') or [],
                    'created_at': item.get('created_at'),
                    'updated_at': item.get('updated_at')
                }
                for key, value in item.items():
                    if key not in normalized:
                        normalized[key] = value
                items.append(normalized)
            if len(items) >= self.MAX_APPLICATIONS:
                break
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        return items

    def get_application(self, app_id: str) -> Optional[Dict[str, Any]]:
        response = self.table.get_item(Key={'application_id': app_id})
        return response.get('Item')

    def get(self, app_id: str) -> Optional[Dict[str, Any]]:
        return self.get_application(app_id)

    def update(self, app_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        from datetime import datetime
        update_expr_parts = []
        expr_attr_names = {}
        expr_attr_values = {}
        for key, value in updates.items():
            update_expr_parts.append(f"#{key} = :{key}")
            expr_attr_names[f"#{key}"] = key
            expr_attr_values[f":{key}"] = value
        if 'updated_at' not in updates:
            update_expr_parts.append("#updated_at = :updated_at")
            expr_attr_names["#updated_at"] = "updated_at"
            expr_attr_values[":updated_at"] = int(datetime.now().timestamp())
        response = self.table.update_item(
            Key={'application_id': app_id},
            UpdateExpression="SET " + ", ".join(update_expr_parts),
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values,
            ReturnValues='ALL_NEW'
        )
        return response.get('Attributes', {})

    def get_applications_by_wave(self, wave_id: str) -> List[Dict[str, Any]]:
        from boto3.dynamodb.conditions import Key
        response = self.table.query(
            IndexName='wave_index', KeyConditionExpression=Key('WAVE').eq(wave_id)
        )
        items = response.get('Items', [])
        while 'LastEvaluatedKey' in response:
            response = self.table.query(
                IndexName='wave_index', KeyConditionExpression=Key('WAVE').eq(wave_id),
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.extend(response.get('Items', []))
        return items

    def get_by_wave(self, wave_id: str) -> List[Dict[str, Any]]:
        return self.get_applications_by_wave(wave_id)

    def get_applications_by_wave_full(self, wave_id: str) -> List[Dict[str, Any]]:
        items = []
        last_key = None
        while True:
            query_kwargs = {
                'IndexName': 'wave_index',
                'KeyConditionExpression': 'WAVE = :wid',
                'ExpressionAttributeValues': {':wid': wave_id},
                'ProjectionExpression': 'application_id, app_id, pam_data, snowflake_data, WAVE',
            }
            if last_key:
                query_kwargs['ExclusiveStartKey'] = last_key
            resp = self.table.query(**query_kwargs)
            items.extend(resp.get('Items', []))
            last_key = resp.get('LastEvaluatedKey')
            if not last_key:
                break
        return items

    @staticmethod
    def _get_timestamp() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
