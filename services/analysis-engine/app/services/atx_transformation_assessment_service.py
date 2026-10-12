"""ATX Transformation Assessment Service — extracts transformation-specific data from ATXDocumentation."""
import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

from app.config import Config

logger = logging.getLogger(__name__)

TRANSFORMATION_EXTRACTION_PROMPT = """You are a senior migration engineer analyzing ATX transformation results. The following ATXDocumentation content is from an ATX code transformation run. Extract EVERY detail you can find — be thorough and comprehensive.

IMPORTANT: Extract ALL file changes, ALL version changes, ALL configuration changes mentioned anywhere in the content. Do not summarize or skip items. If a file was modified, list it. If a version changed, list it.

Extract the following sections as JSON:

1. **transformation_summary**: Object with: transformation_name, description, status (completed/partial/failed), files_modified_count, lines_changed, total_files_in_repo, languages_affected (list)
2. **changes_made**: COMPLETE list of EVERY file change with: file_path, change_type (modified/added/deleted), description (detailed — what exactly changed), before_value, after_value, category (source_code/config/build/infra/test/docs)
3. **version_upgrades**: List of ALL version changes with: component, from_version, to_version, category (language/framework/dependency/sdk/tool/api), notes
4. **breaking_changes**: List of breaking changes with: change, impact (detailed), affected_files (list), manual_action_required (bool), remediation (step-by-step), severity (critical/high/medium/low)
5. **validation_results**: Object with: build_status (pass/fail/unknown), test_status (pass/fail/unknown), test_count, tests_passed, tests_failed, warnings (list of strings), errors (list of strings), build_command, test_command
6. **remaining_work**: List of ALL items needing manual attention with: item, severity (critical/high/medium/low), description (detailed), affected_files (list), estimated_effort (hours), action_required
7. **recommended_next_transformations**: List of follow-up transformations with: name, description, reason, priority (high/medium/low)
8. **technical_debt_resolved**: List of resolved items with: item, severity, category, details
9. **technical_debt_remaining**: List of remaining items with: item, severity, category, details, affected_files
10. **migration_impact**: Object with: risk_level (low/medium/high), rollback_complexity (low/medium/high), testing_requirements (detailed), deployment_notes (detailed), downtime_expected (bool), backward_compatible (bool)
11. **dependency_changes**: List of ALL dependency changes with: name, from_version, to_version, action (upgraded/added/removed/replaced), reason
12. **configuration_changes**: List of config changes with: file_path, setting, old_value, new_value, description
13. **security_impact**: Object with: vulnerabilities_fixed (list), new_risks (list), permissions_changed (list)
14. **code_quality_changes**: Object with: deprecated_apis_removed (list), new_patterns_introduced (list), anti_patterns_fixed (list)
15. **executive_summary**: 5-8 sentence detailed summary covering: what transformation was applied, what changed, what broke, what needs manual attention, what's the risk level, and what should be done next

Output valid JSON only, no markdown wrapping:
"""


class ATXTransformationAssessmentService:
    """Extracts transformation-specific data from ATXDocumentation and stores in DynamoDB."""

    def __init__(self):
        self.table_name = Config.ATX_ASSESSMENTS_TABLE
        self.s3_bucket = Config.S3_ARA_BUCKET
        self.model_id = Config.BEDROCK_MODEL_ID

    def _read_s3_files(self, s3_prefix: str) -> str:
        """Read all markdown files from an S3 prefix and concatenate."""
        s3 = Config.get_boto3_client('s3')
        content_parts = []
        try:
            paginator = s3.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=self.s3_bucket, Prefix=s3_prefix):
                for obj in page.get('Contents', []):
                    if obj['Key'].endswith('.md'):
                        try:
                            resp = s3.get_object(Bucket=self.s3_bucket, Key=obj['Key'])
                            text = resp['Body'].read().decode('utf-8')
                            filename = obj['Key'].split('/')[-1]
                            content_parts.append(f"--- FILE: {filename} ---\n{text}")
                        except Exception as e:
                            logger.warning(f"Failed to read {obj['Key']}: {e}")
        except Exception as e:
            logger.error(f"Failed to list S3 prefix {s3_prefix}: {e}")
        return '\n\n'.join(content_parts)

    def _extract_with_ai(self, content: str, transformation_name: str) -> Dict[str, Any]:
        """Use Bedrock to extract transformation-specific data."""
        if not self.model_id:
            logger.warning("BEDROCK_MODEL_ID not set, returning empty extraction")
            return {}

        if len(content) > 200000:
            content = content[:200000] + "\n\n[TRUNCATED]"

        prompt = f"Transformation applied: {transformation_name}\n\n" + TRANSFORMATION_EXTRACTION_PROMPT + content
        bedrock = Config.get_boto3_client('bedrock-runtime')

        try:
            request_body = {
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {"maxTokens": 10240, "temperature": 0.1}
            }
            response = bedrock.invoke_model(
                modelId=self.model_id,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json"
            )
            resp_body = json.loads(response['body'].read())
            if 'output' in resp_body:
                ai_text = resp_body['output']['message']['content'][0]['text'].strip()
            else:
                ai_text = resp_body.get('content', [{}])[0].get('text', '').strip()

            import re
            json_match = re.search(r'```json\s*(.*?)\s*```', ai_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(1))
            return json.loads(ai_text)
        except json.JSONDecodeError as e:
            logger.error(f"AI returned invalid JSON: {e}")
            return {'error': 'AI returned invalid JSON'}
        except Exception as e:
            logger.error(f"AI extraction failed: {e}", exc_info=True)
            return {'error': str(e)}

    def _store_assessment(self, task_id: str, app_id: str, run_id: str,
                          transformation_name: str, step_index: int, data: Dict[str, Any]) -> None:
        """Store transformation assessment in DynamoDB."""
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.table_name)
        item = {
            'application_id': app_id,
            'repo_run_key': f'{run_id}#transform_{step_index}',
            'task_id': task_id,
            'run_id': run_id,
            'transformation_name': transformation_name,
            'step_index': step_index,
            'assessment_type': 'transformation',
            'assessed_at': datetime.now().isoformat(),
        }
        for field in ['transformation_summary', 'changes_made', 'version_upgrades', 'breaking_changes',
                       'validation_results', 'remaining_work', 'recommended_next_transformations',
                       'technical_debt_resolved', 'technical_debt_remaining', 'migration_impact',
                       'dependency_changes', 'executive_summary', 'configuration_changes',
                       'security_impact', 'code_quality_changes']:
            val = data.get(field, '')
            item[field] = json.dumps(val) if isinstance(val, (dict, list)) else str(val)
        table.put_item(Item=item)
        logger.info(f"Stored transformation assessment for {app_id} step {step_index}")

    def process_transformation_results(self, task_id: str, app_id: str, run_id: str,
                                        transformation_name: str, step_index: int,
                                        s3_prefix: str) -> Dict[str, Any]:
        """Full pipeline: read S3 → AI extract → store in DynamoDB."""
        logger.info(f"Processing transformation assessment for {app_id} step {step_index} from {s3_prefix}")

        prefix = s3_prefix if s3_prefix.endswith('/') else s3_prefix + '/'
        content = self._read_s3_files(prefix + 'ATXDocumentation/')
        if not content:
            content = self._read_s3_files(prefix)
        if not content:
            logger.warning(f"No content found at {s3_prefix}")
            return {'success': False, 'error': 'No ATXDocumentation content found'}

        logger.info(f"Read {len(content)} chars for step {step_index}")
        data = self._extract_with_ai(content, transformation_name)
        if 'error' in data and not data.get('transformation_summary'):
            return {'success': False, 'error': data['error']}

        self._store_assessment(task_id, app_id, run_id, transformation_name, step_index, data)
        return {'success': True, 'app_id': app_id, 'step_index': step_index, 'sections': list(data.keys())}

    def get_transformation_assessments(self, app_id: str, run_id: str = None) -> List[Dict[str, Any]]:
        """Get transformation assessments for an application."""
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.table_name)
        resp = table.query(
            KeyConditionExpression='application_id = :aid',
            ExpressionAttributeValues={':aid': app_id},
            ScanIndexForward=False
        )
        items = [i for i in resp.get('Items', []) if i.get('assessment_type') == 'transformation']
        if run_id:
            items = [i for i in items if i.get('run_id') == run_id]
        for item in items:
            for field in ['transformation_summary', 'changes_made', 'version_upgrades', 'breaking_changes',
                           'validation_results', 'remaining_work', 'recommended_next_transformations',
                           'technical_debt_resolved', 'technical_debt_remaining', 'migration_impact',
                           'dependency_changes', 'configuration_changes', 'security_impact', 'code_quality_changes']:
                if field in item and isinstance(item[field], str):
                    try:
                        item[field] = json.loads(item[field])
                    except json.JSONDecodeError:
                        pass
        return items
