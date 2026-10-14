"""Processor for Default OS components files."""
import logging
import json
import os
import uuid
import asyncio
from typing import Dict, Any, List
from datetime import datetime
import aioboto3

logger = logging.getLogger(__name__)


async def process_default_os_version(
    s3_bucket: str,
    file_key: str,
    application_name: str,
    os_type: str,
    task_id: str,
    notes_service
) -> Dict[str, Any]:
    """Process default OS components file and store in DynamoDB with AI normalization."""
    logger.info(f"Starting default OS processing for {file_key} (OS: {os_type}), task_id: {task_id}")

    try:
        await notes_service.update_processing_task(task_id, 'processing')

        file_content = await _read_s3_file(s3_bucket, file_key)

        if not file_content or not file_content.strip():
            await notes_service.update_processing_task(
                task_id, 'completed', stored_count=0, failed_count=0
            )
            return {'success': True, 'total_records': 0, 'stored_count': 0, 'failed_count': 0}

        logger.info(f"Successfully read file from S3: {file_key} ({len(file_content)} bytes)")

        packages = _parse_packages(file_content, os_type)
        total_records = len(packages)
        logger.info(f"Parsed {total_records} packages from file")

        if total_records == 0:
            await notes_service.update_processing_task(
                task_id, 'completed', stored_count=0, failed_count=0
            )
            return {'success': True, 'total_records': 0, 'stored_count': 0, 'failed_count': 0}

        logger.info(f"Starting AI normalization for {total_records} packages...")
        normalized = await _normalize_packages_with_ai(packages, os_type)
        logger.info(f"AI normalization complete for {len(normalized)} packages")

        # Convert to component dictionaries and deduplicate
        unique_components = {}
        for pkg in normalized:
            try:
                # Remove internal flag before persistence
                pkg.pop('_pre_normalized', None)
                component_id = str(uuid.uuid4())
                dedup_key = f"{pkg['publisher']}|{pkg['product']}|{pkg['version']}"
                if dedup_key not in unique_components:
                    unique_components[dedup_key] = {
                        'component_id': component_id,
                        'application_name': application_name,
                        'product': pkg['product'],
                        'publisher': pkg['publisher'],
                        'software_title': pkg['software_title'],
                        'version': pkg['version'],
                        'os_type': os_type,
                        'file_key': file_key,
                        'created_at': datetime.now().isoformat()
                    }
            except Exception as e:
                logger.error(f"Error creating component from {pkg}: {str(e)}")

        components = list(unique_components.values())
        logger.info(f"Created {len(components)} unique components (deduped from {len(normalized)})")

        result = await notes_service.bulk_write_components(
            components,
            notes_service.default_os_versions_table
        )
        stored_count = result['stored_count']
        failed_count = result['failed_count']

        logger.info(f"Processing complete: {stored_count} stored, {failed_count} failed out of {total_records} total")

        await notes_service.update_processing_task(
            task_id, 'completed',
            total_records=total_records,
            stored_count=stored_count,
            failed_count=failed_count,
            marked_count=stored_count
        )

        return {
            'success': True, 'total_records': total_records,
            'stored_count': stored_count, 'failed_count': failed_count
        }

    except Exception as e:
        error_msg = f"Error processing default OS file {file_key}: {str(e)}"
        logger.error(error_msg, exc_info=True)
        await notes_service.update_processing_task(task_id, 'failed', error_message=error_msg)
        return {
            'success': False, 'total_records': 0,
            'stored_count': 0, 'failed_count': 0, 'error': error_msg
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


def _parse_packages(file_content: str, os_type: str) -> List[Dict[str, str]]:
    """Parse package names from file content.

    Supports two formats:
    1. Pipe-delimited: publisher|product|version (pre-structured, skips AI normalization)
    2. Raw package names: package-version-release.arch (needs AI normalization)
    """
    packages = []
    for line in file_content.split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue

        # Check for pipe-delimited format: publisher|product|version
        parts = line.split('|')
        if len(parts) >= 3:
            publisher = parts[0].strip()[:255]
            product = parts[1].strip()[:255]
            version = parts[2].strip()[:255]
            # Sanitize: strip any HTML/script tags
            import re
            tag_re = re.compile(r'<[^>]+>')
            publisher = tag_re.sub('', publisher)
            product = tag_re.sub('', product)
            version = tag_re.sub('', version)
            if product:
                packages.append({
                    'package_name': product,
                    'os_type': os_type,
                    'product': product,
                    'publisher': publisher if publisher and publisher != '(none)' else 'Unknown',
                    'software_title': product.replace('-', ' ').title(),
                    'version': version,
                    '_pre_normalized': True,
                })
                continue

        # Raw package name format
        packages.append({'package_name': line, 'os_type': os_type})
    return packages


async def _normalize_packages_with_ai(
    packages: List[Dict[str, str]],
    os_type: str
) -> List[Dict[str, str]]:
    """Use Bedrock AI to normalize package names in batches. Skips pre-normalized packages."""
    if not packages:
        return []

    # Separate pre-normalized from raw packages
    raw_packages = [p for p in packages if not p.get('_pre_normalized')]
    pre_normalized = [p for p in packages if p.get('_pre_normalized')]

    if pre_normalized:
        logger.info(f"{len(pre_normalized)} packages already normalized (pipe-delimited format), skipping AI for those")

    if not raw_packages:
        logger.info("All packages pre-normalized, skipping AI entirely")
        return packages

    try:
        from app.config import get_settings
        model_id = get_settings().BEDROCK_MODEL_ID
        if not model_id:
            logger.warning("BEDROCK_MODEL_ID not set, skipping AI normalization")
            for pkg in raw_packages:
                pkg['product'] = pkg['package_name']
                pkg['publisher'] = 'Unknown'
                pkg['software_title'] = pkg['package_name']
                pkg['version'] = ''
            return packages

        batch_size = 50
        max_parallel = get_settings().AI_NORMALIZATION_WORKERS

        batches = []
        for i in range(0, len(packages), batch_size):
            batches.append((i, packages[i:i + batch_size]))

        total_batches = len(batches)
        logger.info(f"Normalizing {len(packages)} packages in {total_batches} batches "
                     f"with {max_parallel} parallel workers")

        results_by_index = {}

        async def normalize_one_batch(start_idx, batch):
            batch_num = start_idx // batch_size + 1
            try:
                batch_results = await _normalize_batch_with_ai(model_id, batch, os_type)
                for pkg, normalized in zip(batch, batch_results):
                    if normalized and normalized.get('product') and normalized.get('publisher'):
                        pkg['product'] = normalized['product']
                        pkg['publisher'] = normalized['publisher']
                        pkg['software_title'] = normalized['software_title']
                        pkg['version'] = normalized['version']
                logger.info(f"Normalized batch {batch_num}/{total_batches} ({len(batch)} packages)")
                return start_idx, batch
            except Exception as e:
                logger.error(f"Error normalizing batch {batch_num}: {str(e)}", exc_info=True)
                for pkg in batch:
                    pkg['product'] = pkg['package_name']
                    pkg['publisher'] = 'Unknown'
                    pkg['software_title'] = pkg['package_name']
                    pkg['version'] = ''
                return start_idx, batch

        semaphore = asyncio.Semaphore(max_parallel)

        async def bounded_normalize(start_idx, batch):
            async with semaphore:
                return await normalize_one_batch(start_idx, batch)

        tasks = [bounded_normalize(start_idx, batch) for start_idx, batch in batches]
        results = await asyncio.gather(*tasks)

        for start_idx, result_batch in results:
            results_by_index[start_idx] = result_batch

        normalized_packages = []
        for start_idx, _ in batches:
            normalized_packages.extend(results_by_index[start_idx])

        return normalized_packages

    except Exception as e:
        logger.error(f"Error in AI normalization: {str(e)}", exc_info=True)
        for pkg in packages:
            pkg['product'] = pkg['package_name']
            pkg['publisher'] = 'Unknown'
            pkg['software_title'] = pkg['package_name']
            pkg['version'] = ''
        return packages


async def _normalize_batch_with_ai(
    model_id: str,
    batch: List[Dict[str, str]],
    os_type: str
) -> List[Dict[str, str]]:
    """Normalize a batch of packages using AI."""
    package_names = [pkg['package_name'] for pkg in batch]

    prompt = f"""Parse the following {os_type} package names and extract structured information.

**Package Names:**
{json.dumps(package_names, indent=2)}

**Extraction Rules:**
1. **Product**: Base package name without version
2. **Publisher**: Likely publisher/vendor based on OS type
3. **Software Title**: Human-readable title
4. **Version**: Version string extracted from package name

**Output Format (JSON array):**
```json
[
  {{"product": "fonts-filesystem", "publisher": "Red Hat", "software_title": "Fonts Filesystem", "version": "2.0.5-7.el9.1"}},
  {{"product": "python3", "publisher": "Red Hat", "software_title": "Python 3", "version": "3.9.7-1.el9"}}
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
            ai_response = ''
            if 'output' in response_body:
                # Nova format: output.message.content[0].text
                ai_response = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()
            else:
                # Claude format: content[0].text
                ai_response = response_body.get('content', [{}])[0].get('text', '').strip()

            normalized_results = _extract_json_from_response(ai_response)
            while len(normalized_results) < len(batch):
                pkg = batch[len(normalized_results)]
                normalized_results.append({
                    'product': pkg['package_name'],
                    'publisher': 'Unknown',
                    'software_title': pkg['package_name'],
                    'version': ''
                })
            return normalized_results
    except Exception as e:
        logger.error(f"Error in AI normalization: {str(e)}", exc_info=True)
        return [{
            'product': pkg['package_name'],
            'publisher': 'Unknown',
            'software_title': pkg['package_name'],
            'version': ''
        } for pkg in batch]


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
                    'product': item.get('product', ''),
                    'publisher': item.get('publisher', 'Unknown'),
                    'software_title': item.get('software_title', ''),
                    'version': item.get('version', '')
                })
            else:
                validated_results.append({
                    'product': '', 'publisher': 'Unknown',
                    'software_title': '', 'version': ''
                })

        return validated_results

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from AI response: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Error extracting JSON: {str(e)}", exc_info=True)
        return []
