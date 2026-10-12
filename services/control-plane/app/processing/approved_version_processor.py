"""Processor for Approved Target Version CSV files."""
import logging
import csv
import io
import json
import os
import asyncio
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import aioboto3

logger = logging.getLogger(__name__)


async def process_approved_version(
    s3_bucket: str,
    file_key: str,
    application_name: str,
    task_id: str,
    notes_service
) -> Dict[str, Any]:
    """Process approved version CSV file and store in DynamoDB with AI normalization."""
    logger.info(f"Starting approved version processing for {file_key}, task_id: {task_id}")

    try:
        await notes_service.update_processing_task(task_id, 'processing')

        file_content = await _read_s3_file(s3_bucket, file_key)

        if not file_content:
            await notes_service.update_processing_task(
                task_id, 'completed',
                stored_count=0, failed_count=0, conflicts_count=0
            )
            return {
                'success': True, 'total_rows': 0,
                'stored_count': 0, 'failed_count': 0, 'conflicts_count': 0
            }

        logger.info(f"Successfully read CSV from S3: {file_key} ({len(file_content)} bytes)")

        components = _parse_csv(file_content, application_name, file_key)
        total_rows = len(components)
        logger.info(f"Parsed {total_rows} components from CSV")

        if total_rows == 0:
            await notes_service.update_processing_task(
                task_id, 'completed',
                stored_count=0, failed_count=0, conflicts_count=0
            )
            return {
                'success': True, 'total_rows': 0,
                'stored_count': 0, 'failed_count': 0, 'conflicts_count': 0
            }

        logger.info(f"Starting AI normalization for {total_rows} components...")

        # Process in batches: normalize then write immediately to avoid memory buildup
        from app.config import get_settings
        model_id = get_settings().BEDROCK_MODEL_ID
        batch_size = 50
        max_parallel = int(os.getenv('AI_NORMALIZATION_WORKERS', '5'))

        total_stored = 0
        total_failed = 0
        seen_keys = set()  # dedup across batches

        batches = [components[i:i + batch_size] for i in range(0, total_rows, batch_size)]
        total_batches = len(batches)
        logger.info(f"Processing {total_rows} components in {total_batches} batches (batch_size={batch_size})")

        semaphore = asyncio.Semaphore(max_parallel)

        async def process_one_batch(batch_idx: int, batch: List[Dict[str, str]]):
            nonlocal total_stored, total_failed
            batch_num = batch_idx + 1

            # Normalize
            async with semaphore:
                try:
                    if model_id:
                        batch_results = await _normalize_batch_with_ai(model_id, batch)
                        for comp, normalized in zip(batch, batch_results):
                            if normalized and normalized.get('normalized_publisher') and normalized.get('normalized_product'):
                                comp['publisher'] = normalized['normalized_publisher']
                                comp['product_key'] = normalized['normalized_product']
                except Exception as e:
                    logger.error(f"Error normalizing batch {batch_num}: {str(e)}", exc_info=True)

            # Deduplicate and build components for this batch
            batch_components = []
            for comp in batch:
                component_id = f"{comp['publisher']}|{comp['product_key']}|{comp['full_version']}"
                if component_id not in seen_keys:
                    seen_keys.add(component_id)
                    batch_components.append({
                        'component_id': component_id,
                        'publisher': comp['publisher'],
                        'product_key': comp['product_key'],
                        'full_version': comp['full_version'],
                        'edition': comp.get('edition', ''),
                        'software_title': comp.get('software_title', ''),
                        'end_of_life_date': comp.get('end_of_life_date', ''),
                        'end_of_support_date': comp.get('end_of_support_date', ''),
                        'application_name': application_name,
                        'uploaded_by': 'system',
                        'file_key': file_key,
                        'created_at': datetime.now().isoformat(),
                        'updated_at': datetime.now().isoformat()
                    })

            # Write immediately to DynamoDB
            if batch_components:
                result = await notes_service.bulk_write_components(
                    batch_components, notes_service.target_components_table
                )
                total_stored += result['stored_count']
                total_failed += result['failed_count']

            logger.info(f"Batch {batch_num}/{total_batches}: normalized and wrote {len(batch_components)} components")

        # Run batches with bounded parallelism
        tasks = [process_one_batch(i, batch) for i, batch in enumerate(batches)]
        await asyncio.gather(*tasks)

        stored_count = total_stored
        failed_count = total_failed

        logger.info(f"Processing complete: {stored_count} stored, {failed_count} failed out of {total_rows} total")

        await notes_service.update_processing_task(
            task_id, 'completed',
            total_records=total_rows,
            stored_count=stored_count,
            failed_count=failed_count,
            conflicts_count=0
        )

        return {
            'success': True, 'total_rows': total_rows,
            'stored_count': stored_count, 'failed_count': failed_count, 'conflicts_count': 0
        }

    except Exception as e:
        error_msg = f"Error processing approved version file {file_key}: {str(e)}"
        logger.error(error_msg, exc_info=True)
        await notes_service.update_processing_task(task_id, 'failed', error_message=error_msg)
        return {
            'success': False, 'total_rows': 0,
            'stored_count': 0, 'failed_count': 0, 'conflicts_count': 0, 'error': error_msg
        }


async def _read_s3_file(s3_bucket: str, file_key: str) -> str:
    """Read file content from S3 using aioboto3."""
    try:
        session = aioboto3.Session(region_name=os.environ.get('AWS_REGION', 'us-east-1'))
        async with session.client('s3') as s3_client:
            logger.info(f"Reading file from S3: s3://{s3_bucket}/{file_key}")
            response = await s3_client.get_object(Bucket=s3_bucket, Key=file_key)
            async with response['Body'] as stream:
                file_content = await stream.read()
            return file_content.decode('utf-8')
    except Exception as e:
        error_msg = f"Failed to read file from S3: {str(e)}"
        logger.error(error_msg, exc_info=True)
        raise Exception(error_msg)


def _parse_csv(content: str, application_name: str, file_key: str) -> List[Dict[str, str]]:
    """Parse CSV content into component dictionaries."""
    components = []
    csv_file = io.StringIO(content)
    reader = csv.DictReader(csv_file)

    for row in reader:
        if not any(row.values()):
            continue
        try:
            component = {
                'publisher': row.get('Publisher', '').strip(),
                'product_key': row.get('Product key', '').strip(),
                'full_version': row.get('Full version', '').strip(),
                'edition': row.get('Edition', '').strip(),
                'software_title': row.get('Software title', '').strip(),
                'end_of_life_date': row.get('End of life date', '').strip(),
                'end_of_support_date': row.get('End of support (EOSL) date', '').strip()
            }
            components.append(component)
        except Exception as e:
            logger.warning(f"Error parsing row: {row}. Error: {str(e)}")
            continue

    return components


async def _normalize_components_with_ai(components: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Use Bedrock AI to normalize publisher and product names."""
    if not components:
        return []

    try:
        from app.config import get_settings
        model_id = get_settings().BEDROCK_MODEL_ID
        if not model_id:
            logger.warning("BEDROCK_MODEL_ID not set, skipping AI normalization")
            return components

        batch_size = 50
        max_parallel = int(os.getenv('AI_NORMALIZATION_WORKERS', '5'))

        batches = []
        for i in range(0, len(components), batch_size):
            batches.append((i, components[i:i + batch_size]))

        total_batches = len(batches)
        logger.info(f"Normalizing {len(components)} components in {total_batches} batches "
                     f"with {max_parallel} parallel workers")

        results_by_index = {}

        async def normalize_one_batch(start_idx, batch):
            batch_num = start_idx // batch_size + 1
            try:
                batch_results = await _normalize_batch_with_ai(model_id, batch)
                for comp, normalized in zip(batch, batch_results):
                    if normalized and normalized.get('normalized_publisher') and normalized.get('normalized_product'):
                        comp['publisher'] = normalized['normalized_publisher']
                        comp['product_key'] = normalized['normalized_product']
                logger.info(f"Normalized batch {batch_num}/{total_batches} ({len(batch)} components)")
                return start_idx, batch
            except Exception as e:
                logger.error(f"Error normalizing batch {batch_num}: {str(e)}", exc_info=True)
                return start_idx, batch

        semaphore = asyncio.Semaphore(max_parallel)

        async def bounded_normalize(start_idx, batch):
            async with semaphore:
                return await normalize_one_batch(start_idx, batch)

        tasks = [bounded_normalize(start_idx, batch) for start_idx, batch in batches]
        results = await asyncio.gather(*tasks)

        for start_idx, result_batch in results:
            results_by_index[start_idx] = result_batch

        normalized_components = []
        for start_idx, _ in batches:
            normalized_components.extend(results_by_index[start_idx])

        return normalized_components

    except Exception as e:
        logger.error(f"Error in AI normalization: {str(e)}", exc_info=True)
        return components


async def _normalize_batch_with_ai(model_id: str, batch: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Normalize a batch of components using AI."""
    components_data = [{'publisher': c['publisher'], 'product': c['product_key']} for c in batch]

    prompt = f"""Normalize the following software publisher and product names for better matching accuracy.

**Components to normalize:**
{json.dumps(components_data, indent=2)}

**Normalization Rules:**

1. **Publisher Normalization:**
   - Remove legal suffixes: "Inc.", "Corp.", "Corporation", "Ltd.", "LLC", etc.
   - Standardize common names (Red Hat, Oracle, Microsoft, etc.)
   - Keep the core brand name only

2. **Product Normalization:**
   - Remove redundant publisher prefix from product name
   - Standardize common product names
   - Use lowercase for system packages (python, gcc, curl)
   - Use proper case for applications (Java Runtime Environment, PostgreSQL)

**Output Format (JSON array):**
```json
[
  {{"normalized_publisher": "Red Hat", "normalized_product": "python"}},
  {{"normalized_publisher": "Oracle", "normalized_product": "Java Runtime Environment (JRE)"}}
]
```

Output JSON only, no additional text:"""

    try:
        session = aioboto3.Session(region_name=os.environ.get('AWS_REGION', 'us-east-1'))
        async with session.client('bedrock-runtime') as bedrock_client:
            request_body = {
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {
                    "maxTokens": 4000,
                    "temperature": 0.1
                }
            }
            response = await bedrock_client.invoke_model(
                modelId=model_id,
                body=json.dumps(request_body),
                contentType="application/json",
                accept="application/json"
            )
            response_body = json.loads(await response['body'].read())

            # Support both Nova and Claude response formats
            if 'output' in response_body:
                ai_response = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()
            else:
                ai_response = response_body.get('content', [{}])[0].get('text', '').strip()
            normalized_results = _extract_json_from_response(ai_response)
            while len(normalized_results) < len(batch):
                normalized_results.append({
                    'normalized_publisher': batch[len(normalized_results)]['publisher'],
                    'normalized_product': batch[len(normalized_results)]['product_key']
                })
            return normalized_results
    except Exception as e:
        logger.error(f"Error in AI normalization: {str(e)}", exc_info=True)
        return [{'normalized_publisher': c['publisher'], 'normalized_product': c['product_key']} for c in batch]


def _extract_json_from_response(ai_response: str) -> List[Dict[str, str]]:
    """Extract JSON array from AI response text."""
    import re

    try:
        json_match = re.search(r'```json\s*(.*?)\s*```', ai_response, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            json_match = re.search(r'\[\s*\{.*?\}\s*\]', ai_response, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
            else:
                logger.warning("Could not find JSON array in AI response")
                return []

        parsed_data = json.loads(json_str)

        if not isinstance(parsed_data, list):
            logger.warning(f"AI response is not a list: {type(parsed_data)}")
            return []

        validated_results = []
        for item in parsed_data:
            if isinstance(item, dict):
                validated_results.append({
                    'normalized_publisher': item.get('normalized_publisher', ''),
                    'normalized_product': item.get('normalized_product', '')
                })
            else:
                validated_results.append({'normalized_publisher': '', 'normalized_product': ''})

        return validated_results

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from AI response: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Error extracting JSON: {str(e)}", exc_info=True)
        return []
