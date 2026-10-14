"""DynamoDB repository base class."""
from typing import Dict, Any, List, Optional
import os
from app.config import Config


class DynamoDBRepository:
    def __init__(self, table_name: str):
        self.table_name = table_name
        self._dynamodb = None
        self._table = None

    @property
    def dynamodb(self):
        if self._dynamodb is None:
            endpoint_url = os.environ.get('DYNAMODB_ENDPOINT')
            if endpoint_url:
                self._dynamodb = Config.get_boto3_resource('dynamodb', endpoint_url=endpoint_url)
            else:
                self._dynamodb = Config.get_boto3_resource('dynamodb')
        return self._dynamodb

    @property
    def table(self):
        if self._table is None:
            self._table = self.dynamodb.Table(self.table_name)
        return self._table

    def create(self, item: Dict[str, Any]) -> Dict[str, Any]:
        self.table.put_item(Item=item)
        return item

    def get(self, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        response = self.table.get_item(Key=key)
        return response.get('Item')

    def update(self, key: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
        update_expr = "SET " + ", ".join([f"#{k} = :{k}" for k in updates.keys()])
        expr_attr_names = {f"#{k}": k for k in updates.keys()}
        expr_attr_values = {f":{k}": v for k, v in updates.items()}
        response = self.table.update_item(
            Key=key, UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values,
            ReturnValues="ALL_NEW"
        )
        return response.get('Attributes')

    def delete(self, key: Dict[str, Any]) -> bool:
        self.table.delete_item(Key=key)
        return True

    def scan(self, filters: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """Scan the table with optional filters, handling pagination automatically."""
        scan_kwargs: Dict[str, Any] = {}

        # Build FilterExpression from filters dict
        if filters:
            from boto3.dynamodb.conditions import Attr
            conditions = None
            for key, value in filters.items():
                condition = Attr(key).eq(value)
                conditions = condition if conditions is None else conditions & condition
            scan_kwargs['FilterExpression'] = conditions

        items: List[Dict[str, Any]] = []
        while True:
            response = self.table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))
            # Continue paginating if there are more results
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                break
            scan_kwargs['ExclusiveStartKey'] = last_key

        return items
