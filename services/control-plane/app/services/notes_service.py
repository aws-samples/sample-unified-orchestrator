"""Notes service for file validation and AWS operations."""
import os
import uuid
import logging
import re
import csv
import json
import io
import asyncio
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import UploadFile, HTTPException
from werkzeug.utils import secure_filename
import aioboto3
import botocore.config

logger = logging.getLogger(__name__)


class NotesService:
    """Service for notes management with async AWS operations."""

    # Note types and their allowed file extensions
    NOTE_TYPES = ['Approved Target Version', 'Default OS components', 'Architecture Decision', 'ATX', 'Application Metadata', 'Application Insights', 'Discovery Notes', 'ATX Common Guidelines']

    NOTE_TYPE_FILE_EXTENSIONS = {
        'Approved Target Version': ['csv'],
        'Default OS components': ['txt', 'md'],
        'Architecture Decision': ['txt', 'md'],
        'ATX': ['json'],
        'Application Metadata': ['json'],
        'Application Insights': ['txt', 'md'],
        'Discovery Notes': ['txt', 'md'],
        'ATX Common Guidelines': ['txt', 'md']
    }

    # Allowed MIME types per extension
    ALLOWED_MIME_TYPES = {
        'csv': ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
        'txt': ['text/plain', 'application/octet-stream'],
        'md': ['text/plain', 'text/markdown', 'application/octet-stream'],
        'json': ['application/json', 'text/plain', 'application/octet-stream'],
    }

    # Binary magic bytes that should never appear in text uploads
    BINARY_SIGNATURES = [
        b'PK',       # ZIP / XLSX / DOCX
        b'%PDF',     # PDF
        b'\x89PNG',  # PNG
        b'\xff\xd8', # JPEG
        b'GIF8',     # GIF
        b'\x1f\x8b', # GZIP
        b'Rar!',     # RAR
        b'\x7fELF',  # ELF binary
        b'MZ',       # Windows EXE/DLL
    ]

    # Max file size per type (bytes)
    MAX_FILE_SIZE = {
        'csv': 10 * 1024 * 1024,   # 10 MB for CSVs
        'txt': 2 * 1024 * 1024,    # 2 MB for text
        'md': 2 * 1024 * 1024,     # 2 MB for markdown
        'json': 5 * 1024 * 1024,   # 5 MB for JSON files
    }

    # S3 path mapping for note types
    NOTE_TYPE_S3_PATHS = {
        'Approved Target Version': 'target-versions',
        'Default OS components': 'default-os-components',
        'Architecture Decision': 'decisions',
        'ATX': 'atx',
        'Application Metadata': 'application-info',
        'Application Insights': 'application-insights',
        'Discovery Notes': 'discovery-notes',
        'ATX Common Guidelines': 'atx-common-guidelines'
    }

    # Required CSV columns for Approved Target Version
    REQUIRED_CSV_COLUMNS = [
        'Publisher',
        'Product key',
        'Full version',
        'Edition',
        'Software title',
        'End of life date',
        'End of support (EOSL) date'
    ]

    def __init__(self, s3_bucket: str, region: str = 'us-east-1'):
        """Initialize notes service.

        Args:
            s3_bucket: S3 bucket name for storing notes
            region: AWS region
        """
        from app.config import get_settings
        settings = get_settings()

        self.s3_bucket = s3_bucket
        self.region = region
        self._session = None

        # DynamoDB table names from config
        self.processing_tasks_table = settings.DYNAMODB_PROCESSING_TASKS_TABLE
        self.target_components_table = settings.DYNAMODB_TARGET_COMPONENTS_TABLE
        self.default_os_versions_table = settings.DYNAMODB_DEFAULT_OS_VERSIONS_TABLE
        self.app_components_table = settings.DYNAMODB_APP_COMPONENTS_TABLE
        self.app_noise_components_table = settings.DYNAMODB_APP_NOISE_COMPONENTS_TABLE
        self.applications_table = settings.APPLICATIONS_TABLE

        logger.info("Initialized NotesService")

    def _get_session(self):
        """Get or create aioboto3 session."""
        if self._session is None:
            self._session = aioboto3.Session(region_name=self.region)
        return self._session

    def _sanitize_filename(self, filename: str) -> str:
        """Sanitize filename for security."""
        filename = os.path.basename(filename)
        base_name = filename.rsplit('.', 1)[0] if '.' in filename else filename
        ext = filename.rsplit('.', 1)[1] if '.' in filename else ''
        safe_base = secure_filename(base_name)
        safe_base = re.sub(r'[^\w\s\-]', '', safe_base)
        safe_base = re.sub(r'[\s]+', '_', safe_base)
        return f"{safe_base}.{ext}" if ext else safe_base

    def _check_double_extension(self, filename: str) -> Optional[str]:
        """Check for suspicious double extensions."""
        name_parts = filename.rsplit('.', 1)
        if len(name_parts) == 2:
            base_name = name_parts[0]
            if '.' in base_name:
                inner_ext = base_name.rsplit('.', 1)[1].lower()
                suspicious = {'exe', 'bat', 'cmd', 'sh', 'ps1', 'dll', 'so', 'bin', 'msi', 'js', 'py', 'php', 'rb'}
                if inner_ext in suspicious:
                    return f'Suspicious double extension in filename: {filename}'
        return None

    def _check_binary_signature(self, content: bytes) -> Optional[str]:
        """Check if content starts with binary signature."""
        for sig in self.BINARY_SIGNATURES:
            if content[:len(sig)] == sig:
                return 'File appears to be binary (not a valid text file).'
        return None

    async def _validate_file(self, file: UploadFile, note_type: str) -> Optional[str]:
        """Validate file size, content-type, and content before upload."""
        filename = file.filename or ''

        # 1. Reject double extensions
        double_ext_error = self._check_double_extension(filename)
        if double_ext_error:
            return double_ext_error

        ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''

        # 2. Check file size
        content = await file.read()
        file_size = len(content)
        await file.seek(0)

        max_size = self.MAX_FILE_SIZE.get(ext, 2 * 1024 * 1024)
        if file_size > max_size:
            max_mb = max_size / (1024 * 1024)
            actual_mb = round(file_size / (1024 * 1024), 2)
            return f'File too large ({actual_mb} MB). Maximum for .{ext} files is {max_mb} MB.'

        if file_size == 0:
            return 'File is empty.'

        # 3. Validate MIME content-type
        content_type = (file.content_type or '').lower()
        allowed_mimes = self.ALLOWED_MIME_TYPES.get(ext, [])
        if allowed_mimes and content_type and content_type not in allowed_mimes:
            return f'Invalid content type "{content_type}" for .{ext} file. Expected one of: {", ".join(allowed_mimes)}'

        # 4. Check for binary signatures
        header = content[:8] if len(content) >= 8 else content
        binary_error = self._check_binary_signature(header)
        if binary_error:
            return binary_error

        return None

    def allowed_file(self, filename: str, note_type: str) -> bool:
        """Check if file extension is allowed for the given note type."""
        if '.' not in filename:
            return False
        ext = filename.rsplit('.', 1)[1].lower()
        allowed_exts = self.NOTE_TYPE_FILE_EXTENSIONS.get(note_type, [])
        return ext in allowed_exts

    async def _validate_csv(self, file: UploadFile) -> Optional[str]:
        """Validate CSV file has required columns."""
        try:
            content = await file.read()
            await file.seek(0)

            try:
                text_content = content.decode('utf-8')
            except UnicodeDecodeError:
                return 'Invalid CSV file: File encoding is not UTF-8'

            csv_reader = csv.DictReader(io.StringIO(text_content))

            if not csv_reader.fieldnames:
                return 'Invalid CSV file: No columns found'

            missing_columns = []
            for required_col in self.REQUIRED_CSV_COLUMNS:
                if required_col not in csv_reader.fieldnames:
                    missing_columns.append(required_col)

            if missing_columns:
                return f'Invalid CSV file: Missing required columns: {", ".join(missing_columns)}'

            return None

        except csv.Error as e:
            return f'Invalid CSV file: {str(e)}'
        except Exception as e:
            return f'Error validating CSV file: {str(e)}'

    async def _validate_json(self, file: UploadFile) -> Optional[str]:
        """Validate JSON file structure."""
        try:
            content = await file.read()
            await file.seek(0)

            try:
                text_content = content.decode('utf-8')
                json.loads(text_content)
                return None
            except UnicodeDecodeError:
                return 'Invalid JSON file: File encoding is not UTF-8'
            except json.JSONDecodeError as e:
                return f'Invalid JSON file: {str(e)}'

        except Exception as e:
            return f'Error validating JSON file: {str(e)}'

    async def upload_note(
        self,
        file: UploadFile,
        note_type: str,
        application_name: str = 'ALL',
        os_type: Optional[str] = None,
        created_by: Optional[str] = None,
        application_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Upload a note file to S3 and start processing if needed."""
        try:
            if not file or not file.filename:
                raise HTTPException(status_code=400, detail='No file selected')

            if note_type not in self.NOTE_TYPES:
                raise HTTPException(
                    status_code=400,
                    detail=f'Invalid note type. Must be one of: {self.NOTE_TYPES}'
                )

            if not self.allowed_file(file.filename, note_type):
                allowed_exts = self.NOTE_TYPE_FILE_EXTENSIONS.get(note_type, [])
                raise HTTPException(
                    status_code=400,
                    detail=f'File type not allowed for {note_type}. Allowed formats: {", ".join(allowed_exts)}'
                )

            validation_error = await self._validate_file(file, note_type)
            if validation_error:
                raise HTTPException(status_code=400, detail=validation_error)

            if note_type == 'Approved Target Version':
                csv_error = await self._validate_csv(file)
                if csv_error:
                    raise HTTPException(status_code=400, detail=csv_error)

            if note_type == 'ATX':
                json_error = await self._validate_json(file)
                if json_error:
                    raise HTTPException(status_code=400, detail=json_error)

            if note_type == 'Application Metadata':
                json_error = await self._validate_json(file)
                if json_error:
                    raise HTTPException(status_code=400, detail=json_error)

            if note_type == 'Default OS components' and not os_type:
                raise HTTPException(
                    status_code=400,
                    detail='OS type is required for Default OS components'
                )

            # Generate unique filename
            file_ext = file.filename.rsplit('.', 1)[1].lower()
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            unique_id = str(uuid.uuid4())[:8]
            safe_filename = self._sanitize_filename(file.filename.rsplit('.', 1)[0])

            s3_path = self.NOTE_TYPE_S3_PATHS.get(note_type, note_type.replace(' ', '_').lower())
            app_folder = application_id if application_id and application_name != 'ALL' else 'all'
            s3_key = f"notes/{s3_path}/{app_folder}/{timestamp}_{unique_id}_{safe_filename}.{file_ext}"

            metadata = {
                'note_type': note_type,
                'application_name': application_name,
                'uploaded_at': datetime.now().isoformat()
            }
            if os_type:
                metadata['os_type'] = os_type

            # Upload to S3
            session = self._get_session()
            async with session.client('s3') as s3_client:
                content = await file.read()
                await file.seek(0)
                await s3_client.put_object(
                    Bucket=self.s3_bucket,
                    Key=s3_key,
                    Body=content,
                    Metadata=metadata
                )

            logger.info(f"Uploaded file to S3: {s3_key}")

            # Create processing task for applicable note types
            task_id = None
            processing_status = None

            if note_type in ['Approved Target Version', 'Default OS components', 'Application Metadata']:
                task_id = str(uuid.uuid4())
                await self.create_processing_task(task_id, s3_key, application_name, created_by)
                processing_status = 'pending'
                logger.info(f"Created processing task: {task_id}")

                if note_type == 'Approved Target Version':
                    asyncio.create_task(self._process_approved_version_async(
                        s3_key, application_name, task_id
                    ))
                elif note_type == 'Default OS components':
                    asyncio.create_task(self._process_default_os_async(
                        s3_key, application_name, os_type, task_id
                    ))
                elif note_type == 'Application Metadata':
                    asyncio.create_task(self._process_application_info_async(
                        s3_key, task_id
                    ))

            return {
                'success': True,
                'message': 'File uploaded successfully',
                'data': {
                    'file_key': s3_key,
                    'bucket': self.s3_bucket,
                    'note_type': note_type,
                    'application_name': application_name,
                    'filename': file.filename,
                    'processing_task_id': task_id,
                    'processing_status': processing_status
                }
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f'Error during upload: {str(e)}', exc_info=True)
            raise HTTPException(status_code=500, detail='Internal server error')

    async def list_notes(
        self,
        note_type: Optional[str] = None,
        application_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """List all uploaded notes with processing status."""
        try:
            prefix = 'notes/'
            if note_type:
                s3_path = self.NOTE_TYPE_S3_PATHS.get(note_type, note_type.replace(' ', '_').lower())
                prefix += f"{s3_path}/"

            logger.info(f"Listing notes with prefix: {prefix}")

            session = self._get_session()
            notes = []

            async with session.client('s3') as s3_client:
                response = await s3_client.list_objects_v2(
                    Bucket=self.s3_bucket,
                    Prefix=prefix
                )

                if 'Contents' in response:
                    for obj in response['Contents']:
                        try:
                            metadata_response = await s3_client.head_object(
                                Bucket=self.s3_bucket,
                                Key=obj['Key']
                            )
                            metadata = metadata_response.get('Metadata', {})

                            # Filter by application_name if provided (match against metadata)
                            if application_name and application_name != 'ALL':
                                meta_app = metadata.get('application_name', '')
                                meta_app_id = metadata.get('application_id', '')
                                if meta_app != application_name and meta_app_id != application_name:
                                    continue

                            note_data = {
                                'file_key': obj['Key'],
                                'filename': obj['Key'].split('/')[-1],
                                'size': obj['Size'],
                                'last_modified': obj['LastModified'].isoformat(),
                                'note_type': metadata.get('note_type', 'Unknown'),
                                'application_name': metadata.get('application_name', 'Unknown'),
                                'os_type': metadata.get('os_type'),
                                'processing_status': None,
                                'processing_task_id': None
                            }

                            task = await self.get_processing_task_by_file_key(obj['Key'])
                            if task:
                                note_data['processing_status'] = task.get('status')
                                note_data['processing_task_id'] = task.get('task_id')
                                note_data['stored_count'] = task.get('stored_count')
                                note_data['marked_count'] = task.get('marked_count')
                                note_data['conflicts_count'] = task.get('conflicts_count')
                                note_data['total_records'] = task.get('total_records')
                            else:
                                # S3-only note types — show as active/stored
                                s3_only_types = ['Architecture Decision', 'Application Insights', 'Discovery Notes', 'ATX Common Guidelines', 'ATX']
                                nt = metadata.get('note_type', '')
                                if nt in s3_only_types:
                                    note_data['processing_status'] = 'active'

                            notes.append(note_data)
                        except Exception as e:
                            logger.error(f"Error processing note {obj['Key']}: {str(e)}")
                            continue

            return {
                'success': True,
                'notes': notes,
                'count': len(notes)
            }

        except Exception as e:
            logger.error(f'Error listing notes: {str(e)}', exc_info=True)
            raise HTTPException(status_code=500, detail='Internal server error')

    async def get_download_url(self, file_key: str) -> Dict[str, Any]:
        """Generate a presigned URL for downloading a note."""
        try:
            session = self._get_session()
            async with session.client('s3', config=botocore.config.Config(signature_version='s3v4')) as s3_client:
                url = await s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': self.s3_bucket, 'Key': file_key},
                    ExpiresIn=3600
                )
            # S3 always generates HTTPS URLs with s3v4 signing, but enforce as a safeguard
            if url.startswith('http://'):
                url = url.replace('http://', 'https://', 1)
            return {'success': True, 'download_url': url}
        except Exception as e:
            logger.error(f'Error generating download URL: {str(e)}', exc_info=True)
            raise HTTPException(status_code=500, detail='Internal server error')

    async def delete_note(self, file_key: str) -> Dict[str, Any]:
        """Delete a note from S3 and associated data from DynamoDB."""
        try:
            session = self._get_session()
            async with session.client('s3') as s3_client:
                await s3_client.delete_object(
                    Bucket=self.s3_bucket,
                    Key=file_key
                )
            logger.info(f"Deleted file from S3: {file_key}")

            deleted_components = 0
            message = 'File deleted successfully'
            if deleted_components > 0:
                message += f' (and {deleted_components} associated components)'

            return {
                'success': True,
                'message': message,
                'deleted_components': deleted_components
            }
        except Exception as e:
            logger.error(f'Error during deletion: {str(e)}', exc_info=True)
            raise HTTPException(status_code=500, detail='Internal server error')

    def get_note_types(self) -> Dict[str, Any]:
        """Get available note types with their allowed file extensions."""
        return {
            'success': True,
            'note_types': self.NOTE_TYPES,
            'file_extensions': self.NOTE_TYPE_FILE_EXTENSIONS
        }

    # DynamoDB Operations

    async def _get_dynamodb_client(self):
        """Get async DynamoDB client."""
        session = self._get_session()
        return session.resource('dynamodb', region_name=self.region)

    async def create_processing_task(
        self,
        task_id: str,
        file_key: str,
        application_name: str,
        created_by: Optional[str] = None
    ) -> None:
        """Create a processing task in DynamoDB."""
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(self.processing_tasks_table)
                item = {
                    'task_id': task_id,
                    'status': 'pending',
                    'file_key': file_key,
                    'application_name': application_name,
                    'created_at': datetime.now().isoformat(),
                    'updated_at': datetime.now().isoformat()
                }
                if created_by:
                    item['created_by'] = created_by
                await table.put_item(Item=item)
            logger.info(f"Created processing task: {task_id}")
        except Exception as e:
            logger.error(f"Error creating processing task: {str(e)}")
            raise

    async def update_processing_task(
        self,
        task_id: str,
        status: str,
        **kwargs
    ) -> None:
        """Update a processing task in DynamoDB."""
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(self.processing_tasks_table)
                update_expr = 'SET #status = :status, updated_at = :updated_at'
                expr_attr_names = {'#status': 'status'}
                expr_attr_values = {
                    ':status': status,
                    ':updated_at': datetime.now().isoformat()
                }
                for key, value in kwargs.items():
                    update_expr += f', {key} = :{key}'
                    expr_attr_values[f':{key}'] = value
                await table.update_item(
                    Key={'task_id': task_id},
                    UpdateExpression=update_expr,
                    ExpressionAttributeNames=expr_attr_names,
                    ExpressionAttributeValues=expr_attr_values
                )
            logger.info(f"Updated processing task {task_id} to status: {status}")
        except Exception as e:
            logger.error(f"Error updating processing task: {str(e)}")
            raise

    async def get_processing_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get a processing task by ID."""
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(self.processing_tasks_table)
                response = await table.get_item(Key={'task_id': task_id})
                return response.get('Item')
        except Exception as e:
            logger.error(f"Error getting processing task: {str(e)}")
            return None

    async def list_processing_tasks(self, limit: int = 100) -> List[Dict[str, Any]]:
        """List processing tasks."""
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(self.processing_tasks_table)
                response = await table.scan(Limit=limit)
                return response.get('Items', [])
        except Exception as e:
            logger.error(f"Error listing processing tasks: {str(e)}")
            return []

    async def get_processing_task_by_file_key(self, file_key: str) -> Optional[Dict[str, Any]]:
        """Get a processing task by file key."""
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(self.processing_tasks_table)
                response = await table.query(
                    IndexName='file_key_index',
                    KeyConditionExpression='file_key = :file_key',
                    ExpressionAttributeValues={':file_key': file_key}
                )
                items = response.get('Items', [])
                return items[0] if items else None
        except Exception as e:
            logger.error(f"Error getting processing task by file_key: {str(e)}")
            return None

    async def bulk_write_components(
        self,
        components: List[Dict[str, Any]],
        table_name: str = 'target_components'
    ) -> Dict[str, int]:
        """Bulk write components to DynamoDB."""
        stored_count = 0
        failed_count = 0
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(table_name)
                batch_size = 25
                for i in range(0, len(components), batch_size):
                    batch = components[i:i + batch_size]
                    try:
                        async with table.batch_writer() as writer:
                            for component in batch:
                                await writer.put_item(Item=component)
                                stored_count += 1
                    except Exception as e:
                        logger.error(f"Error writing batch: {str(e)}")
                        failed_count += len(batch)
                        continue
            return {'stored_count': stored_count, 'failed_count': failed_count}
        except Exception as e:
            logger.error(f"Error in bulk write: {str(e)}")
            raise

    async def delete_components_by_file(
        self,
        file_key: str,
        table_name: str = 'target_components'
    ) -> int:
        """Delete components associated with a file."""
        deleted_count = 0
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(table_name)
                items = []
                query_kwargs = {
                    'IndexName': 'file_key_index',
                    'KeyConditionExpression': 'file_key = :file_key',
                    'ExpressionAttributeValues': {':file_key': file_key}
                }
                while True:
                    response = await table.query(**query_kwargs)
                    items.extend(response.get('Items', []))
                    if 'LastEvaluatedKey' not in response:
                        break
                    query_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']

                batch_size = 25
                for i in range(0, len(items), batch_size):
                    batch = items[i:i + batch_size]
                    try:
                        async with table.batch_writer() as writer:
                            for item in batch:
                                await writer.delete_item(
                                    Key={'component_id': item['component_id']}
                                )
                                deleted_count += 1
                    except Exception as e:
                        logger.error(f"Error deleting batch: {str(e)}")
                        continue
            return deleted_count
        except Exception as e:
            logger.error(f"Error deleting components: {str(e)}")
            return 0

    async def list_default_os_versions(
        self,
        application_name: Optional[str] = None,
        limit: int = 100
    ) -> Dict[str, Any]:
        """List default OS versions from DynamoDB."""
        try:
            async with await self._get_dynamodb_client() as dynamodb:
                table = await dynamodb.Table(self.default_os_versions_table)
                if application_name:
                    response = await table.query(
                        IndexName='application_name_index',
                        KeyConditionExpression='application_name = :app_name',
                        ExpressionAttributeValues={':app_name': application_name},
                        Limit=limit
                    )
                else:
                    response = await table.scan(Limit=limit)
                items = response.get('Items', [])
                return {
                    'success': True,
                    'components': items,
                    'count': len(items)
                }
        except Exception as e:
            logger.error(f"Error listing default OS versions: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail='Internal server error')

    async def _process_approved_version_async(
        self,
        file_key: str,
        application_name: str,
        task_id: str
    ) -> None:
        """Trigger async processing for Approved Target Version."""
        try:
            from app.processing.approved_version_processor import process_approved_version
            await process_approved_version(
                self.s3_bucket,
                file_key,
                application_name,
                task_id,
                self
            )
        except Exception as e:
            logger.error(f"Error in approved version processing: {str(e)}", exc_info=True)
            try:
                await self.update_processing_task(task_id, 'failed', error_message=str(e))
            except Exception as update_err:
                logger.debug(f"Failed to update task status: {update_err}")

    async def _process_default_os_async(
        self,
        file_key: str,
        application_name: str,
        os_type: str,
        task_id: str
    ) -> None:
        """Trigger async processing for Default OS components, then run noise filtering."""
        try:
            from app.processing.default_os_version_processor import process_default_os_version
            result = await process_default_os_version(
                self.s3_bucket,
                file_key,
                application_name,
                os_type,
                task_id,
                self
            )

            if result.get('success') and result.get('stored_count', 0) > 0:
                logger.info(f"Auto-triggering noise filter for all applications with os_type={os_type}")
                from app.processing.noise_filter_processor import process_noise_filter
                noise_result = await process_noise_filter(
                    application_name='ALL',
                    os_type=os_type,
                    dynamodb_table=self.app_components_table,
                    default_os_table=self.default_os_versions_table,
                    noise_table=self.app_noise_components_table,
                )
                if noise_result.get('success'):
                    noise_marked = noise_result.get('marked_count', 0)
                    logger.info(f"Noise filter complete: {noise_marked} components moved to noise table")
                    await self.update_processing_task(
                        task_id, 'completed',
                        marked_count=noise_marked
                    )
                else:
                    logger.error(f"Noise filter failed: {noise_result.get('error')}")
        except Exception as e:
            logger.error(f"Error in default OS processing: {str(e)}", exc_info=True)
            try:
                await self.update_processing_task(task_id, 'failed', error_message=str(e))
            except Exception as update_err:
                logger.debug(f"Failed to update task status: {update_err}")

    async def _process_application_info_async(
        self,
        file_key: str,
        task_id: str
    ) -> None:
        """Process Application Metadata JSON and update applications table."""
        try:
            await self.update_processing_task(task_id, 'processing')

            # Read JSON from S3
            session = self._get_session()
            async with session.client('s3') as s3_client:
                response = await s3_client.get_object(Bucket=self.s3_bucket, Key=file_key)
                async with response['Body'] as stream:
                    content = await stream.read()

            import json
            apps = json.loads(content.decode('utf-8'))

            if not isinstance(apps, list):
                await self.update_processing_task(task_id, 'failed', error_message='JSON must be an array of application objects')
                return

            updated = 0
            failed = 0

            async with session.resource('dynamodb') as dynamodb:
                table = await dynamodb.Table(self.applications_table)

                for app in apps:
                    app_id = app.get('application_id')
                    if not app_id:
                        logger.error("Application Metadata: entry missing application_id, skipping")
                        failed += 1
                        continue

                    # Build update expression dynamically
                    update_parts = []
                    attr_values = {}
                    attr_names = {}

                    if 'SCM_URLS' in app and app['SCM_URLS']:
                        update_parts.append('#scm = :scm')
                        attr_values[':scm'] = app['SCM_URLS']
                        attr_names['#scm'] = 'scm_urls'

                    if 'WAVE' in app and app['WAVE']:
                        update_parts.append('WAVE = :wave')
                        attr_values[':wave'] = app['WAVE']

                    if not update_parts:
                        logger.warning(f"Application Metadata: no fields to update for {app_id}")
                        continue

                    try:
                        update_kwargs = {
                            'Key': {'application_id': str(app_id)},
                            'UpdateExpression': 'SET ' + ', '.join(update_parts),
                            'ExpressionAttributeValues': attr_values,
                            'ConditionExpression': 'attribute_exists(application_id)'
                        }
                        if attr_names:
                            update_kwargs['ExpressionAttributeNames'] = attr_names

                        await table.update_item(**update_kwargs)
                        updated += 1
                        logger.info(f"Application Metadata: updated {app_id}")
                    except Exception as e:
                        error_code = getattr(e, 'response', {}).get('Error', {}).get('Code', '')
                        if error_code == 'ConditionalCheckFailedException':
                            logger.error(f"Application Metadata: application_id {app_id} not found in table")
                        else:
                            logger.error(f"Application Metadata: failed to update {app_id}: {e}")
                        failed += 1

            await self.update_processing_task(
                task_id, 'completed',
                total_records=len(apps),
                stored_count=updated,
                failed_count=failed
            )
            logger.info(f"Application Metadata processing complete: {updated} updated, {failed} failed out of {len(apps)}")

        except Exception as e:
            logger.error(f"Error processing Application Metadata: {str(e)}", exc_info=True)
            await self.update_processing_task(task_id, 'failed', error_message=str(e))
