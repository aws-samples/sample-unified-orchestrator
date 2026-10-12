"""
Noise Filter Processor

Marks app components as noise based on matches with default OS components.
Uses semantic publisher matching (e.g., Red Hat → Rocky).
"""

import logging
import asyncio
from typing import Dict, List, Any, Set, Tuple
import aioboto3
from botocore.exceptions import ClientError

from app.config import get_settings

logger = logging.getLogger(__name__)

_RPM_PUBLISHERS = ['red hat', 'rocky', 'rocky enterprise software foundation', 'rocky linux',
                   'centos', 'fedora project', 'oracle', 'amazon']
_DEB_PUBLISHERS = ['canonical', 'ubuntu', 'debian']
_GNU_PUBLISHERS = ['fsf', 'free software foundation']


class PublisherNormalizer:
    """Normalizes publisher names for semantic matching."""

    PUBLISHER_EQUIVALENTS: Dict[str, List[str]] = {
        'red hat': ['rocky', 'red hat', 'rocky enterprise software foundation', 'rocky linux'],
        'rocky enterprise software foundation': ['rocky', 'red hat', 'rocky enterprise software foundation', 'rocky linux'],
        'rocky linux': ['rocky', 'red hat', 'rocky enterprise software foundation', 'rocky linux'],
        'rocky': ['rocky', 'red hat', 'rocky enterprise software foundation', 'rocky linux'],
        'canonical': ['canonical', 'ubuntu'],
        'ubuntu': ['canonical', 'ubuntu'],
        'centos': ['centos', 'red hat', 'rocky enterprise software foundation'],
        'fedora project': ['fedora project', 'red hat'],
        'debian': ['debian'],
        'fsf': ['fsf', 'free software foundation'],
        'free software foundation': ['fsf', 'free software foundation'],
    }

    @classmethod
    def normalize(cls, publisher: str) -> str:
        if not publisher:
            return ''
        return publisher.lower().strip()

    @classmethod
    def get_equivalents(cls, publisher: str) -> List[str]:
        normalized = cls.normalize(publisher)
        if normalized in cls.PUBLISHER_EQUIVALENTS:
            equivalents = cls.PUBLISHER_EQUIVALENTS[normalized]
            logger.debug(f"Publisher '{publisher}' maps to equivalents: {equivalents}")
            return equivalents
        logger.debug(f"Publisher '{publisher}' has no equivalents, using exact match")
        return [normalized]

    @classmethod
    def matches(cls, publisher1: str, publisher2: str) -> bool:
        norm2 = cls.normalize(publisher2)
        equivalents = cls.get_equivalents(publisher1)
        return norm2 in equivalents


class NoiseFilter:
    """Utility for filtering app components against default OS components."""

    def __init__(self):
        self.normalizer = PublisherNormalizer()

    def filter_components(
        self,
        components: List[Dict[str, Any]],
        default_os_components: List[Dict[str, Any]]
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """Filter components into clean and noise lists."""
        if not default_os_components:
            logger.info("No default OS components provided, all components are clean")
            return components, []

        logger.info(f"Filtering {len(components)} components against {len(default_os_components)} default OS components")
        default_lookup = self._build_lookup_index(default_os_components)
        logger.info(f"Built lookup index with {len(default_lookup)} unique products")

        clean_components = []
        noise_components = []

        for component in components:
            if self._is_noise(component, default_lookup):
                noise_components.append(component)
            else:
                clean_components.append(component)

        logger.info(f"Filtering complete: {len(clean_components)} clean, {len(noise_components)} noise")
        return clean_components, noise_components

    def _build_lookup_index(self, default_components: List[Dict[str, Any]]) -> Dict[str, Set[str]]:
        lookup = {}
        for comp in default_components:
            product = comp.get('product', '')
            publisher = comp.get('software_publisher', '') or comp.get('publisher', '')
            if not product:
                continue
            norm_product = self._normalize_string(product)
            norm_publisher = self.normalizer.normalize(publisher)
            if norm_product not in lookup:
                lookup[norm_product] = set()
            lookup[norm_product].add(norm_publisher)
        return lookup

    def _is_noise(self, component: Dict[str, Any], default_lookup: Dict[str, Set[str]]) -> bool:
        product = component.get('product', '')
        publisher = component.get('software_publisher', '') or component.get('publisher', '')
        if not product:
            return False
        norm_publisher = self.normalizer.normalize(publisher)

        # If the publisher is a known OS publisher, treat as noise regardless of product
        all_os = set(_RPM_PUBLISHERS + _DEB_PUBLISHERS + _GNU_PUBLISHERS + ['(none)', 'unknown'])
        if norm_publisher in all_os:
            return True

        norm_product = self._normalize_string(product)
        if norm_product not in default_lookup:
            return False
        default_publishers = default_lookup[norm_product]
        equivalent_publishers = self.normalizer.get_equivalents(publisher)
        for equiv in equivalent_publishers:
            if equiv in default_publishers:
                return True
        return False

    def _normalize_string(self, s: str) -> str:
        if not s:
            return ''
        return s.lower().strip()


async def process_noise_filter(
    application_name: str,
    os_type: str,
    dynamodb_table: str,
    default_os_table: str,
    noise_table: str
) -> Dict[str, Any]:
    """Mark app components as noise based on default OS components."""
    logger.info(f"Starting noise filtering for application={application_name}, os_type={os_type}")

    try:
        session = aioboto3.Session(region_name=get_settings().AWS_REGION)

        async with session.resource('dynamodb') as dynamodb:
            target_table = await dynamodb.Table(dynamodb_table)
            default_table = await dynamodb.Table(default_os_table)
            noise_table_resource = await dynamodb.Table(noise_table)

            logger.info(f"Querying default OS components for os_type={os_type}")
            default_components = await _query_default_os_components(default_table, os_type)

            if not default_components:
                logger.info(f"No default OS components found for os_type={os_type}")
                return {'success': True, 'marked_count': 0, 'message': 'No default OS components found'}

            logger.info(f"Found {len(default_components)} default OS components")

            if application_name == 'ALL':
                # Get app list from applications table instead of scanning components table
                apps_table = await dynamodb.Table(get_settings().APPLICATIONS_TABLE)
                apps_resp = await apps_table.scan(ProjectionExpression='application_id, APPLICATION_NAME, application_name')
                app_entries = []
                for item in apps_resp.get('Items', []):
                    aid = item.get('application_id', '')
                    aname = item.get('APPLICATION_NAME') or item.get('application_name', '')
                    if aid:
                        app_entries.append((aname, aid))
            else:
                app_entries = [(application_name, '')]

            if not app_entries:
                logger.info("No applications found in app-components table")
                return {'success': True, 'marked_count': 0, 'message': 'No applications found'}

            logger.info(f"Processing noise filter for {len(app_entries)} application(s)")

            total_marked = 0
            noise_filter = NoiseFilter()

            for app_name, app_id in app_entries:
                logger.info(f"Querying app components for {app_name} (id={app_id})")
                app_components = await _query_app_components(target_table, application_id=app_id, application_name=app_name)

                if not app_components:
                    logger.info(f"No app components found for {app_name}")
                    continue

                logger.info(f"Found {len(app_components)} app components for {app_name}")
                clean_components, noise_components = noise_filter.filter_components(
                    app_components, default_components
                )

                if not noise_components:
                    logger.info(f"No matching noise components for {app_name}")
                    continue

                logger.info(f"Found {len(noise_components)} noise components for {app_name}")
                marked_count = await _bulk_write_noise_components(noise_table_resource, noise_components)
                deleted_count = await _bulk_delete_components(target_table, noise_components)
                logger.info(f"[{app_name}] Moved {marked_count} to noise table, deleted {deleted_count} from app-components")
                total_marked += marked_count

            return {'success': True, 'marked_count': total_marked}

    except Exception as e:
        error_msg = f"Error in noise filtering: {str(e)}"
        logger.error(error_msg, exc_info=True)
        return {'success': False, 'marked_count': 0, 'error': error_msg}


async def _query_default_os_components(table, os_type: str) -> List[Dict[str, Any]]:
    """Query all default OS components for a given os_type using os_type_index GSI."""
    try:
        items = []
        query_kwargs = {
            'IndexName': 'os_type_index',
            'KeyConditionExpression': 'os_type = :os_type',
            'ExpressionAttributeValues': {':os_type': os_type}
        }
        while True:
            response = await table.query(**query_kwargs)
            items.extend(response.get('Items', []))
            if 'LastEvaluatedKey' not in response:
                break
            query_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        return items
    except ClientError as e:
        # Fall back to scan if GSI doesn't exist yet
        if 'ValidationException' in str(e):
            logger.warning("os_type_index GSI not found, falling back to scan")
            return await _query_default_os_components_scan(table, os_type)
        logger.error(f"Error querying default OS components: {e}")
        return []


async def _query_default_os_components_scan(table, os_type: str) -> List[Dict[str, Any]]:
    """Fallback: scan with filter if os_type_index GSI is not available."""
    try:
        items = []
        scan_kwargs = {
            'FilterExpression': 'os_type = :os_type',
            'ExpressionAttributeValues': {':os_type': os_type}
        }
        while True:
            response = await table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))
            if 'LastEvaluatedKey' not in response:
                break
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        return items
    except ClientError as e:
        logger.error(f"Error scanning default OS components: {e}")
        return []


async def _query_app_components(table, application_name: str = None, application_id: str = None) -> List[Dict[str, Any]]:
    """Query app components from DynamoDB using application_name_index or application_id_index GSI."""
    try:
        items = []
        if application_id and application_id.strip():
            query_kwargs = {
                'IndexName': 'application_id_index',
                'KeyConditionExpression': 'application_id = :aid',
                'ExpressionAttributeValues': {':aid': application_id}
            }
        elif application_name and application_name.strip():
            query_kwargs = {
                'IndexName': 'application_name_index',
                'KeyConditionExpression': 'application_name = :app_name',
                'ExpressionAttributeValues': {':app_name': application_name}
            }
        else:
            logger.warning("_query_app_components called without valid application_name or application_id")
            return []
        while True:
            response = await table.query(**query_kwargs)
            items.extend(response.get('Items', []))
            if 'LastEvaluatedKey' not in response:
                break
            query_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        return items
    except ClientError as e:
        logger.error(f"Error querying app components: {e}")
        return []


async def _bulk_write_noise_components(table, components: List[Dict[str, Any]]) -> int:
    """Bulk write noise components to DynamoDB."""
    if not components:
        return 0
    success_count = 0
    batch_size = 25
    for i in range(0, len(components), batch_size):
        batch = components[i:i + batch_size]
        try:
            async with table.batch_writer() as writer:
                for component in batch:
                    await writer.put_item(Item=component)
                    success_count += 1
        except ClientError as e:
            logger.error(f"Error writing batch to noise table: {e}")
    return success_count


async def _bulk_delete_components(table, components: List[Dict[str, Any]]) -> int:
    """Bulk delete components from DynamoDB."""
    if not components:
        return 0
    deleted_count = 0
    batch_size = 25
    for i in range(0, len(components), batch_size):
        batch = components[i:i + batch_size]
        try:
            async with table.batch_writer() as writer:
                for component in batch:
                    component_id = component.get('component_id')
                    if component_id:
                        await writer.delete_item(Key={'component_id': component_id})
                        deleted_count += 1
        except ClientError as e:
            logger.error(f"Error deleting batch from target table: {e}")
    return deleted_count
