"""Risk assessment repository for DynamoDB operations."""
from typing import Dict, Any, Optional, List
from .dynamodb_repository import DynamoDBRepository
from ..models.risk_assessment import RiskAssessment


class RiskAssessmentRepository(DynamoDBRepository):
    def __init__(self):
        from app.config import Config
        super().__init__(Config.RISK_ASSESSMENTS_TABLE)

    def create_assessment(self, assessment: RiskAssessment) -> RiskAssessment:
        self.create(assessment.to_dict())
        return assessment

    def get_assessment(self, assessment_id: str, app_id: str) -> Optional[RiskAssessment]:
        item = self.get({'assessment_id': assessment_id, 'app_id': app_id})
        return RiskAssessment.from_dict(item) if item else None

    def get_assessment_by_id(self, assessment_id: str) -> Optional[RiskAssessment]:
        from boto3.dynamodb.conditions import Key
        try:
            response = self.table.query(KeyConditionExpression=Key('assessment_id').eq(assessment_id))
            items = response.get('Items', [])
            if items:
                return RiskAssessment.from_dict(items[0])
        except Exception:
            pass
        return None

    def get_assessments_by_app(self, app_id: str) -> List[RiskAssessment]:
        from boto3.dynamodb.conditions import Key
        try:
            response = self.table.query(
                IndexName='app_id_index', KeyConditionExpression=Key('app_id').eq(app_id)
            )
            items = response.get('Items', [])
            while 'LastEvaluatedKey' in response:
                response = self.table.query(
                    IndexName='app_id_index', KeyConditionExpression=Key('app_id').eq(app_id),
                    ExclusiveStartKey=response['LastEvaluatedKey']
                )
                items.extend(response.get('Items', []))
        except Exception:
            return []
        assessments = []
        for item in items:
            try:
                assessments.append(RiskAssessment.from_dict(item))
            except (KeyError, TypeError):
                continue
        return assessments

    def get_all_assessments(self) -> List[RiskAssessment]:
        items = self.scan()
        assessments = []
        for item in items:
            try:
                assessments.append(RiskAssessment.from_dict(item))
            except (KeyError, TypeError):
                continue
        return assessments
    def update_assessment(self, assessment_id: str, app_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing assessment record in DynamoDB."""
        key = {'assessment_id': assessment_id, 'app_id': app_id}
        return self.update(key, updates)
