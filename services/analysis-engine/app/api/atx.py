"""ATX Code Analysis API — consolidated endpoints with lazy loading."""
import io
import os
import json
import uuid
import logging
import zipfile
from collections import defaultdict
from datetime import datetime
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.utils.auth import User, get_current_user, get_accessible_app_ids
from app.config import Config
from app.services.atx_service import ATXService
from app.services.atx_assessment_service import ATXAssessmentService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ara/atx", tags=["ATX Code Analysis"])
_executor = ThreadPoolExecutor(max_workers=4)


class RunAnalysisRequest(BaseModel):
    application_ids: List[str]
    branch: Optional[str] = None
    selected_files: Optional[dict] = None
    selected_repos: Optional[dict] = None  # {app_id: [repo_urls]}


def _get_tasks_table():
    return Config.get_boto3_resource('dynamodb').Table(Config.ATX_PROCESSING_TASKS_TABLE)


def _query_tasks_by_app(table, app_id: str) -> list:
    """Query tasks by application_id. Falls back to scan if GSI doesn't exist."""
    try:
        resp = table.query(
            IndexName='application_id_index',
            KeyConditionExpression='application_id = :aid',
            ExpressionAttributeValues={':aid': app_id},
            ScanIndexForward=False
        )
    except Exception:
        resp = table.scan(
            FilterExpression='application_id = :aid',
            ExpressionAttributeValues={':aid': app_id},
        )
    return sorted(resp.get('Items', []), key=lambda t: t.get('created_at', ''), reverse=True)


def _run_local_worker(task_id: str, app_id: str, repo_url: str, run_id: str, selected_files: list):
    """Run ATX for a single repo locally in a thread (dev mode)."""
    from app.workers.atx_worker import main as worker_main
    import os
    os.environ['ATX_TASK_ID'] = task_id
    os.environ['ATX_APP_ID'] = app_id
    os.environ['ATX_REPO_URL'] = repo_url
    os.environ['ATX_RUN_ID'] = run_id
    os.environ['ATX_SELECTED_FILES'] = json.dumps(selected_files)
    try:
        worker_main()
    except SystemExit:
        pass  # worker calls sys.exit on failure


# --- POST /run ---
@router.post("/run")
async def run_code_analysis(request: RunAnalysisRequest, user: User = Depends(get_current_user)):
    """Submit ATX code analysis. Uses ECS Fargate (production) or local threads (dev)."""
    svc = ATXService()
    table = _get_tasks_table()
    run_mode = Config.ATX_RUN_MODE
    errors = []
    for app_id in request.application_ids:
        app = svc.get_application(app_id)
        if not app:
            errors.append(f"Application {app_id} not found")
        elif not (app.get('scm_urls') or app.get('SCM_URLS')):
            errors.append(f"Application {app_id} has no SCM_URLS")
    if errors:
        raise HTTPException(status_code=400, detail={'errors': errors})

    all_tasks = []
    for app_id in request.application_ids:
        app = svc.get_application(app_id)
        all_urls = app.get('scm_urls') or app.get('SCM_URLS') or []
        selected_repos = (request.selected_repos or {}).get(app_id, [])
        repo_urls = selected_repos if selected_repos else all_urls
        if request.branch:
            repo_urls = [f"{url.split('#')[0]}#{request.branch}" for url in repo_urls]
        selected_files = (request.selected_files or {}).get(app_id, [])

        run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        task_id = str(uuid.uuid4())[:12]

        repo_statuses = {}
        for url in repo_urls:
            name = url.split('#')[0].rstrip('/').split('/')[-1].replace('.git', '')
            repo_statuses[name] = {'status': 'pending'}

        table.put_item(Item={
            'task_id': task_id, 'application_id': app_id, 'task_type': 'atx_run',
            'status': 'processing', 'run_id': run_id, 'branch': request.branch or '',
            'selected_files': selected_files, 'selected_repos': list(repo_urls),
            'repo_statuses': repo_statuses, 's3_prefix': f'atx-results/{app_id}/{run_id}',
            'created_at': datetime.now().isoformat(), 'updated_at': datetime.now().isoformat(),
        })

        repos_launched = 0
        if run_mode == 'ecs':
            from app.services.ecs_task_launcher import ECSTaskLauncher
            launcher = ECSTaskLauncher()
            launch_results = launcher.launch_tasks_for_app(task_id, app_id, repo_urls, run_id, selected_files)
            ecs_arns = {r['repo_name']: r.get('ecs_task_arn', '') for r in launch_results if r.get('success')}
            if ecs_arns:
                table.update_item(Key={'task_id': task_id}, UpdateExpression='SET ecs_task_arns = :arns',
                                  ExpressionAttributeValues={':arns': ecs_arns})
            repos_launched = len([r for r in launch_results if r.get('success')])
        else:
            # Local mode — run each repo in a thread
            for url in repo_urls:
                _executor.submit(_run_local_worker, task_id, app_id, url, run_id, selected_files)
                repos_launched += 1

        all_tasks.append({
            'task_id': task_id, 'application_id': app_id, 'run_id': run_id,
            'mode': run_mode, 'repos_launched': repos_launched, 'repos_total': len(repo_urls)
        })

    return {'success': True, 'message': f'Launched for {len(request.application_ids)} app(s) (mode: {run_mode})', 'tasks': all_tasks}


# --- POST /run-combined --- (phased combined analysis with dependency discovery)
def _run_local_combined(task_id: str, app_id: str, repo_urls: list, run_id: str, selected_files: list):
    """Run combined phased analysis locally in a thread (dev mode)."""
    from app.workers.atx_worker import run_combined
    try:
        run_combined(task_id, app_id, repo_urls, run_id, selected_files)
    except Exception as e:
        logger.error(f"Combined worker failed for {app_id}: {e}", exc_info=True)
        try:
            table = _get_tasks_table()
            table.update_item(Key={'task_id': task_id},
                UpdateExpression='SET #s = :s, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':s': 'failed', ':u': datetime.now().isoformat()})
        except Exception:
            pass


@router.post("/run-combined")
async def run_combined_analysis(request: RunAnalysisRequest, user: User = Depends(get_current_user)):
    """Submit combined phased ATX analysis: dependency discovery → ordered per-repo analysis with context chaining."""
    svc = ATXService()
    table = _get_tasks_table()
    errors = []
    for app_id in request.application_ids:
        app = svc.get_application(app_id)
        if not app:
            errors.append(f"Application {app_id} not found")
        elif not (app.get('scm_urls') or app.get('SCM_URLS')):
            errors.append(f"Application {app_id} has no SCM_URLS")
    if errors:
        raise HTTPException(status_code=400, detail={'errors': errors})

    all_tasks = []
    for app_id in request.application_ids:
        app = svc.get_application(app_id)
        all_urls = app.get('scm_urls') or app.get('SCM_URLS') or []
        selected_repos = (request.selected_repos or {}).get(app_id, [])
        repo_urls = selected_repos if selected_repos else all_urls
        if request.branch:
            repo_urls = [f"{url.split('#')[0]}#{request.branch}" for url in repo_urls]
        selected_files = (request.selected_files or {}).get(app_id, [])

        run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        task_id = str(uuid.uuid4())[:12]

        repo_statuses = {}
        for url in repo_urls:
            name = url.split('#')[0].rstrip('/').split('/')[-1].replace('.git', '')
            repo_statuses[name] = {'status': 'pending'}

        table.put_item(Item={
            'task_id': task_id, 'application_id': app_id, 'task_type': 'atx_combined',
            'status': 'processing', 'run_id': run_id,
            'selected_files': selected_files, 'selected_repos': list(repo_urls),
            'repo_statuses': repo_statuses, 's3_prefix': f'atx-results/{app_id}/{run_id}',
            'created_at': datetime.now().isoformat(), 'updated_at': datetime.now().isoformat(),
        })

        # Launch combined worker — ECS or local thread
        run_mode = Config.ATX_RUN_MODE
        if run_mode == 'ecs':
            from app.services.ecs_task_launcher import ECSTaskLauncher
            launcher = ECSTaskLauncher()
            result = launcher.launch_combined_task(task_id, app_id, list(repo_urls), run_id, selected_files)
            if result.get('success'):
                table.update_item(Key={'task_id': task_id},
                    UpdateExpression='SET ecs_task_arn = :arn',
                    ExpressionAttributeValues={':arn': result['ecs_task_arn']})
        else:
            _executor.submit(_run_local_combined, task_id, app_id, list(repo_urls), run_id, selected_files)

        all_tasks.append({
            'task_id': task_id, 'application_id': app_id, 'run_id': run_id,
            'mode': f'combined-{run_mode}', 'repos_total': len(repo_urls),
        })

    return {'success': True, 'message': f'Combined analysis launched for {len(request.application_ids)} app(s)', 'tasks': all_tasks}


# --- GET /tasks --- (merged: list all or get one or filter by app_id)
@router.get("/tasks")
async def get_tasks(
    task_id: Optional[str] = None,
    app_id: Optional[str] = None,
    user: User = Depends(get_current_user)
):
    """Get tasks. Use task_id for single, app_id to filter, or neither for all."""
    table = _get_tasks_table()
    if task_id:
        resp = table.get_item(Key={'task_id': task_id})
        item = resp.get('Item')
        if not item:
            raise HTTPException(status_code=404, detail='Task not found')
        return {'success': True, 'task': item}
    if app_id:
        items = _query_tasks_by_app(table, app_id)
    else:
        resp = table.scan(Limit=500)
        items = sorted(resp.get('Items', []), key=lambda x: x.get('created_at', ''), reverse=True)

    # POD-scoped filtering: restrict to accessible apps
    allowed = get_accessible_app_ids(user)
    if allowed is not None:
        items = [t for t in items if t.get('app_id') in allowed]

    return {'success': True, 'tasks': items}


# --- GET /applications/{app_id} --- (single endpoint, lazy load via include param)
@router.get("/applications/{app_id}")
async def get_application_atx(
    app_id: str,
    include: str = Query('status', description='Comma-separated: status,files,results,assessments'),
    run_id: Optional[str] = Query(None, description='Filter assessments by run_id'),
    user: User = Depends(get_current_user),
):
    """Single endpoint for all app-level ATX data. Use include param for lazy loading."""
    parts = [p.strip() for p in include.split(',')]
    data: dict = {'app_id': app_id}

    # Status: latest task status for this app
    if 'status' in parts:
        table = _get_tasks_table()
        tasks = _query_tasks_by_app(table, app_id)
        if tasks:
            latest = tasks[0]
            s = latest.get('status', '')
            atx_results_str = latest.get('atx_results', '{}')
            try:
                atx_results = json.loads(atx_results_str) if isinstance(atx_results_str, str) else (atx_results_str or {})
            except (json.JSONDecodeError, TypeError):
                atx_results = {}
            repo_results = atx_results.get('results', [])
            completed_repos = sum(1 for r in repo_results if r.get('atx_success') and r.get('upload', {}).get('success'))
            if s in ('pending', 'processing'):
                data['latest_status'] = 'in_progress'
            elif s == 'failed' and completed_repos > 0:
                data['latest_status'] = 'completed'
            elif s in ('atx_complete', 'extracting'):
                data['latest_status'] = 'in_progress'
            else:
                data['latest_status'] = s
            data['latest_task_id'] = latest.get('task_id')
        else:
            data['latest_status'] = None

    # Files: relevant notes files for context selection
    if 'files' in parts:
        try:
            data['files'] = ATXService().get_relevant_files(app_id)
        except Exception as e:
            logger.error(f"Failed to load relevant files for {app_id}: {e}")
            data['files'] = []

    # Results: S3 run listing — group per-repo prefixes back into runs.
    # Workers upload to  atx-results/{app_id}/{run_id}_{repo_name}/…
    # so a single run with 2 repos produces two S3 "folders".  We need
    # to group them by the original run_id (everything before the last
    # underscore-separated repo name segment that was appended by the
    # worker).  The run_id itself has the form YYYYMMDD_HHMMSS_<hex8>.
    if 'results' in parts:
        client = Config.get_boto3_client('s3')
        bucket = Config.S3_ARA_BUCKET
        prefix = f'atx-results/{app_id}/'
        try:
            resp = client.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter='/')

            # Resolve the canonical run_id from the DynamoDB task records
            # so we can reliably split "{run_id}_{repo_name}" prefixes.
            task_table = _get_tasks_table()
            task_resp = task_table.query(
                IndexName='application_id_index',
                KeyConditionExpression='application_id = :aid',
                ExpressionAttributeValues={':aid': app_id}
            )
            known_run_ids = {t['run_id'] for t in task_resp.get('Items', []) if t.get('run_id')}

            # Build a dict  run_id -> [repo_entry, …]
            runs_map: dict = defaultdict(lambda: {'repos': {}, 'files': []})

            for cp in resp.get('CommonPrefixes', []):
                rp = cp['Prefix']                       # e.g. atx-results/app1/20240315_120000_abc12345_repoName/
                folder_name = rp.rstrip('/').split('/')[-1]  # 20240315_120000_abc12345_repoName

                # Try to match against known run_ids from DynamoDB
                matched_run_id = None
                repo_name = None
                for rid in known_run_ids:
                    if folder_name.startswith(rid + '_'):
                        matched_run_id = rid
                        repo_name = folder_name[len(rid) + 1:]
                        break
                    elif folder_name == rid:
                        matched_run_id = rid
                        repo_name = None
                        break

                if not matched_run_id:
                    # Fallback: treat the whole folder name as the run_id
                    matched_run_id = folder_name

                fr = client.list_objects_v2(Bucket=bucket, Prefix=rp)
                files = [{'key': o['Key'], 'filename': o['Key'].split('/')[-1], 'size': o['Size'],
                          'last_modified': o['LastModified'].isoformat()} for o in fr.get('Contents', [])]

                entry = runs_map[matched_run_id]
                entry['files'].extend(files)
                if repo_name:
                    entry['repos'][repo_name] = {
                        'repo_name': repo_name,
                        'files': files,
                        'file_count': len(files),
                    }

            runs = []
            for rid, info in runs_map.items():
                runs.append({
                    'run_id': rid,
                    'files': info['files'],
                    'file_count': len(info['files']),
                    'repos': list(info['repos'].values()) if info['repos'] else [],
                    'repo_count': len(info['repos']) if info['repos'] else 1,
                })
            runs.sort(key=lambda r: r['run_id'], reverse=True)
            data['results'] = runs
        except Exception:
            data['results'] = []

    # Assessments: structured AI-extracted data
    if 'assessments' in parts:
        svc = ATXAssessmentService()
        assessment = svc.get_latest_assessment(app_id, run_id=run_id)
        data['assessments'] = assessment

    return {'success': True, 'data': data}


# --- POST /status --- (bulk status check for app list)
@router.post("/status")
async def check_status(app_ids: List[str], user: User = Depends(get_current_user)):
    """Bulk status check for multiple apps. Returns per-app status with repo-level detail."""
    table = _get_tasks_table()
    result = {}
    for app_id in app_ids:
        tasks = _query_tasks_by_app(table, app_id)
        # Only consider analysis tasks for status — not transform tasks
        analysis_tasks = [t for t in tasks if t.get('task_type') != 'atx_transform']
        if not analysis_tasks:
            continue
        latest = analysis_tasks[0]

        # Read per-repo statuses directly from task record
        repo_statuses = latest.get('repo_statuses', {})
        if isinstance(repo_statuses, str):
            try:
                repo_statuses = json.loads(repo_statuses)
            except (json.JSONDecodeError, TypeError):
                repo_statuses = {}

        total_repos = len(repo_statuses)
        completed_repos = sum(1 for r in repo_statuses.values()
                             if (r.get('status') if isinstance(r, dict) else r) == 'completed')
        failed_repos = sum(1 for r in repo_statuses.values()
                          if (r.get('status') if isinstance(r, dict) else r) == 'failed')
        in_progress = total_repos - completed_repos - failed_repos

        # Determine display status
        if total_repos == 0:
            display_status = latest.get('status', 'pending')
        elif in_progress > 0:
            display_status = 'in_progress'
        elif completed_repos > 0:
            display_status = 'completed'
        else:
            display_status = 'failed'

        app_status: dict = {
            'status': display_status,
            'run_id': latest.get('run_id', ''),
            'task_id': latest.get('task_id', ''),
            'total_repos': total_repos,
            'completed_repos': completed_repos,
            'failed_repos': failed_repos,
        }

        # Include dependency graph fields when present (combined phased analysis)
        if latest.get('dependency_graph'):
            app_status['dependency_graph'] = latest['dependency_graph']
        if latest.get('execution_order'):
            app_status['execution_order'] = latest['execution_order']
        if latest.get('mermaid_diagram'):
            app_status['mermaid_diagram'] = latest['mermaid_diagram']
        if latest.get('current_repo'):
            app_status['current_repo'] = latest['current_repo']
        if 'current_repo_index' in latest:
            app_status['current_repo_index'] = latest['current_repo_index']
        if latest.get('repo_summaries'):
            app_status['repo_summaries'] = latest['repo_summaries']
        if repo_statuses:
            app_status['repo_statuses'] = repo_statuses

        result[app_id] = app_status
    return {'success': True, 'statuses': result}


# --- GET /status/stream --- (SSE: push status updates while any app is in progress)
@router.get("/status/stream")
async def stream_status(app_ids: str, user: User = Depends(get_current_user)):
    """Server-Sent Events stream for real-time status updates.
    Emits status every 5s while any app is in_progress, then closes.
    app_ids: comma-separated list of application IDs
    """
    import asyncio

    ids = [i.strip() for i in app_ids.split(',') if i.strip()]

    def get_statuses() -> dict:
        table = _get_tasks_table()
        result = {}
        for app_id in ids:
            tasks = _query_tasks_by_app(table, app_id)
            if not tasks:
                continue
            latest = tasks[0]
            repo_statuses = latest.get('repo_statuses', {})
            if isinstance(repo_statuses, str):
                try:
                    repo_statuses = json.loads(repo_statuses)
                except (json.JSONDecodeError, TypeError):
                    repo_statuses = {}
            total = len(repo_statuses)
            completed = sum(1 for r in repo_statuses.values() if (r.get('status') if isinstance(r, dict) else r) == 'completed')
            failed = sum(1 for r in repo_statuses.values() if (r.get('status') if isinstance(r, dict) else r) == 'failed')
            in_prog = total - completed - failed
            if total == 0:
                display = latest.get('status', 'pending')
            elif in_prog > 0:
                display = 'in_progress'
            elif completed > 0:
                display = 'completed'
            else:
                display = 'failed'
            result[app_id] = {
                'status': display,
                'total_repos': total,
                'completed_repos': completed,
                'failed_repos': failed,
                'repo_statuses': repo_statuses,
            }
        return result

    async def event_generator():
        max_iterations = 720  # 1 hour max (720 * 5s)
        for i in range(max_iterations):
            statuses = get_statuses()
            yield f"data: {json.dumps(statuses)}\n\n"
            logger.info(f"[SSE] Push #{i+1} for app_ids={app_ids[:30]}... statuses={list(statuses.keys())}")
            # Stop streaming once all apps are done
            if statuses and all(s.get('status') not in ('in_progress',) for s in statuses.values()):
                break
            await asyncio.sleep(5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- GET /download/{app_id}/{run_id} --- (single file or zip)
@router.get("/download/{app_id}/{run_id}")
async def download(
    app_id: str, run_id: str,
    file: Optional[str] = Query(None, description='Relative file path for single file download'),
    zip: bool = Query(False, description='Download entire run as zip'),
    user: User = Depends(get_current_user),
):
    """Download a single file (presigned URL) or entire run as zip."""
    bucket = Config.S3_ARA_BUCKET
    client = Config.get_boto3_client('s3')

    if zip:
        # Try both S3 prefixes: atx-results (code analysis) and atx-transformation (transforms)
        files = []
        found_prefix = ''
        for s3_base in ['atx-results', 'atx-transformation']:
            prefix = f'{s3_base}/{app_id}/{run_id}'
            paginator = client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for obj in page.get('Contents', []):
                    files.append(obj['Key'])
            if files:
                found_prefix = f'{s3_base}/{app_id}/'
                break
        if not files:
            raise HTTPException(status_code=404, detail='No files found for this run')
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
            for k in files:
                resp = client.get_object(Bucket=bucket, Key=k)
                zf.writestr(k[len(found_prefix):], resp['Body'].read())
        buf.seek(0)
        return StreamingResponse(buf, media_type='application/zip',
            headers={'Content-Disposition': f'attachment; filename="{app_id}_{run_id}.zip"'})

    if file:
        s3_key = f'atx-results/{app_id}/{run_id}/{file}'
        try:
            client.head_object(Bucket=bucket, Key=s3_key)
            url = client.generate_presigned_url('get_object', Params={'Bucket': bucket, 'Key': s3_key}, ExpiresIn=3600)
            return {'success': True, 'url': url}
        except Exception:
            raise HTTPException(status_code=404, detail=f'File not found: {s3_key}')

    raise HTTPException(status_code=400, detail='Specify file= for single download or zip=true for zip')


# --- GET /config --- (expose ATX config to frontend)
@router.get("/config", deprecated=True)
async def get_atx_config(user: User = Depends(get_current_user)):
    """Get ATX configuration (transformation name, etc.)."""
    return {'success': True, 'transformation_name': Config.ATX_TRANSFORMATION_NAME}


# --- POST /retry --- (resume failed ATX run using conversation_id)
@router.post("/retry/{task_id}")
async def retry_analysis(task_id: str, user: User = Depends(get_current_user)):
    """Retry failed repos by launching new ECS Fargate tasks."""
    table = _get_tasks_table()
    resp = table.get_item(Key={'task_id': task_id})
    task = resp.get('Item')
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')

    app_id = task['application_id']
    selected_files = task.get('selected_files', [])
    selected_repos = task.get('selected_repos', [])

    # Find failed repos from repo_statuses
    repo_statuses = task.get('repo_statuses', {})
    failed_repos = [name for name, info in repo_statuses.items()
                    if (info.get('status') if isinstance(info, dict) else info) == 'failed']

    if not failed_repos and not selected_repos:
        raise HTTPException(status_code=400, detail='No failed repos to retry')

    # Resolve repo URLs from selected_repos or app SCM_URLS
    svc = ATXService()
    app = svc.get_application(app_id)
    all_urls = app.get('scm_urls') or app.get('SCM_URLS') or []

    # Match failed repo names back to URLs
    retry_urls = []
    for url in (selected_repos or all_urls):
        name = url.split('#')[0].rstrip('/').split('/')[-1].replace('.git', '')
        if name in failed_repos or not failed_repos:
            retry_urls.append(url)

    if not retry_urls:
        raise HTTPException(status_code=400, detail='No repos to retry')

    run_id = task.get('run_id', f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}")
    new_task_id = str(uuid.uuid4())[:12]

    repo_statuses_new = {url.split('#')[0].rstrip('/').split('/')[-1].replace('.git', ''): {'status': 'pending'}
                         for url in retry_urls}

    table.put_item(Item={
        'task_id': new_task_id, 'application_id': app_id, 'task_type': 'atx_retry',
        'status': 'processing', 'run_id': run_id,
        'selected_files': selected_files, 'selected_repos': list(retry_urls),
        'repo_statuses': repo_statuses_new, 'retry_of': task_id,
        'created_at': datetime.now().isoformat(), 'updated_at': datetime.now().isoformat(),
    })

    from app.services.ecs_task_launcher import ECSTaskLauncher
    launcher = ECSTaskLauncher()
    launch_results = launcher.launch_tasks_for_app(new_task_id, app_id, retry_urls, run_id, selected_files)
    launched = len([r for r in launch_results if r.get('success')])

    return {'success': True, 'task_id': new_task_id, 'message': f'Retry launched {launched}/{len(retry_urls)} repos'}


# --- POST /extract/{app_id} --- (manual trigger for Step 2: AI assessment extraction)
@router.post("/extract/{app_id}")
async def extract_assessment(
    app_id: str,
    run_id: Optional[str] = Query(None, description='Specific run_id. If omitted, uses latest run from S3.'),
    user: User = Depends(get_current_user),
):
    """
    Manually trigger AI assessment extraction (Step 2) for an app that already has
    ATXDocumentation uploaded to S3.
    """
    bucket = Config.S3_ARA_BUCKET
    if not bucket:
        raise HTTPException(status_code=500, detail='S3_ARA_BUCKET not configured')

    client = Config.get_boto3_client('s3')

    if not run_id:
        prefix = f'atx-results/{app_id}/'
        try:
            resp = client.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter='/')
            prefixes = [cp['Prefix'] for cp in resp.get('CommonPrefixes', [])]
            if not prefixes:
                raise HTTPException(status_code=404, detail=f'No ATX runs found for {app_id} in S3')
            prefixes.sort(reverse=True)
            run_id = prefixes[0].rstrip('/').split('/')[-1]
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'Failed to list S3 runs: {e}')

    run_prefix = f'atx-results/{app_id}/{run_id}'
    try:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=f'atx-results/{app_id}/', Delimiter='/')
        all_run_prefixes = [cp['Prefix'] for cp in resp.get('CommonPrefixes', [])]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to list runs: {e}')

    repo_results = []

    for rp in all_run_prefixes:
        rid = rp.rstrip('/').split('/')[-1]
        parts = rid.split('_')
        if len(parts) >= 3:
            rid_base = '_'.join(parts[:3])
        else:
            rid_base = rid

        if run_id and (rid == run_id or rid.startswith(run_id) or rid_base == run_id or run_id.startswith(rid_base)):
            if len(parts) > 3:
                repo_name = '_'.join(parts[3:])
            else:
                repo_name = rid
            check = client.list_objects_v2(Bucket=bucket, Prefix=f'{rp}ATXDocumentation/', MaxKeys=1)
            has_docs = check.get('KeyCount', 0) > 0
            if has_docs:
                repo_results.append({
                    'repo_name': repo_name,
                    'upload': {'success': True, 's3_prefix': rp.rstrip('/')}
                })

    if not repo_results:
        check = client.list_objects_v2(Bucket=bucket, Prefix=f'{run_prefix}/ATXDocumentation/', MaxKeys=1)
        if check.get('KeyCount', 0) > 0:
            repo_name = run_id.split('_', 3)[-1] if '_' in run_id else run_id
            repo_results.append({
                'repo_name': repo_name,
                'upload': {'success': True, 's3_prefix': run_prefix}
            })

    if not repo_results:
        raise HTTPException(status_code=404, detail=f'No ATXDocumentation found in S3 for run {run_id}')

    from app.strands.tools.atx.extract_atx_assessment import extract_atx_assessment
    parts = run_id.split('_')
    assessment_run_id = '_'.join(parts[:3]) if len(parts) >= 3 else run_id

    result = extract_atx_assessment(app_id, assessment_run_id, repo_results)

    # Update stuck task status
    table = _get_tasks_table()
    tasks = _query_tasks_by_app(table, app_id)
    if tasks:
        latest = tasks[0]
        if latest.get('status') in ('atx_complete', 'extracting', 'processing'):
            table.update_item(
                Key={'task_id': latest['task_id']},
                UpdateExpression='SET #s = :s, updated_at = :t, assessment_results = :ar',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={
                    ':s': 'completed',
                    ':t': datetime.now().isoformat(),
                    ':ar': json.dumps(result)
                }
            )

    return {
        'success': result.get('success', False),
        'app_id': app_id,
        'run_id': assessment_run_id,
        'repos_extracted': len(repo_results),
        'result': result
    }


# ============================================================
# ATX Transformation Endpoints
# ============================================================

def _run_transform_local(task_id: str):
    """Run transformation pipeline locally in a thread."""
    logger.info(f"[Transform] Starting local worker for task: {task_id}")
    try:
        from app.workers.atx_transform_worker import run_transform_pipeline
        run_transform_pipeline(task_id)
    except Exception as e:
        logger.error(f"[Transform] Local worker failed for {task_id}: {e}", exc_info=True)
        try:
            table = _get_tasks_table()
            table.update_item(Key={'task_id': task_id},
                UpdateExpression='SET #s = :s, updated_at = :u',
                ExpressionAttributeNames={'#s': 'status'},
                ExpressionAttributeValues={':s': 'failed', ':u': datetime.now().isoformat()})
        except Exception:
            pass


@router.post("/transform")
async def submit_transformation(
    payload: str = Form(...),
    user: User = Depends(get_current_user),
):
    """Submit ATX transformation pipeline. Context files uploaded separately."""
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail='Invalid JSON payload')

    app_id = data.get('application_id')
    repo_url = data.get('repo_url')
    branch = data.get('branch', '')
    push_to_repo = data.get('push_to_repo', True)
    transformations = data.get('transformations', [])
    target_version = data.get('target_version', '')

    if not app_id or not repo_url or not transformations or not branch:
        raise HTTPException(status_code=400, detail='application_id, repo_url, branch, and transformations required')

    # Validate that each transformation has context_text (additionalPlanContext is mandatory)
    for i, t in enumerate(transformations):
        if not t.get('context_text', '').strip():
            raise HTTPException(
                status_code=400,
                detail=f'Transformation step {i + 1} ({t.get("name", "unnamed")}) requires context text (additionalPlanContext). '
                       f'Provide target version, migration goals, or specific instructions.'
            )

    run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    task_id = f"tr-{uuid.uuid4().hex[:10]}"
    s3_prefix = f"atx-transformation/{app_id}/{run_id}"
    table = _get_tasks_table()

    # Build transformation records — resolve selected_notes to S3 keys
    transform_records = []
    for i, t in enumerate(transformations):
        context_files_s3 = t.get('selected_notes', []) or []
        transform_records.append({
            'name': t.get('name', ''),
            'order': i,
            'status': 'pending',
            'context_text': t.get('context_text', ''),
            'context_files_s3': context_files_s3,
            'result_s3_prefix': '',
        })

    # Save task to DynamoDB
    repo_name = repo_url.split('#')[0].rstrip('/').split('/')[-1].replace('.git', '')
    table.put_item(Item={
        'task_id': task_id,
        'task_type': 'atx_transform',
        'application_id': app_id,
        'repo_url': repo_url,
        'repo_name': repo_name,
        'branch': branch,
        'push_to_repo': push_to_repo,
        'target_version': target_version,
        'run_id': run_id,
        'status': 'pending',
        's3_prefix': s3_prefix,
        'transformations': transform_records,
        'created_at': datetime.now().isoformat(),
        'updated_at': datetime.now().isoformat(),
    })

    # Launch worker
    run_mode = Config.ATX_RUN_MODE
    if run_mode == 'ecs':
        from app.services.ecs_task_launcher import ECSTaskLauncher
        launcher = ECSTaskLauncher()
        ecs_result = launcher.ecs.run_task(
            cluster=launcher.cluster,
            taskDefinition=launcher.task_definition,
            launchType='FARGATE',
            count=1,
            networkConfiguration={
                'awsvpcConfiguration': {
                    'subnets': launcher.subnets,
                    'securityGroups': launcher.security_groups,
                    'assignPublicIp': 'DISABLED'
                }
            },
            overrides={
                'containerOverrides': [{
                    'name': 'atx-worker',
                    'command': ['python', '-m', 'app.workers.atx_transform_worker', task_id],
                    'environment': [
                        {'name': 'ATX_TRANSFORM_TASK_ID', 'value': task_id},
                    ],
                }]
            },
        )
        ecs_arn = ecs_result.get('tasks', [{}])[0].get('taskArn', '')
        table.update_item(Key={'task_id': task_id},
            UpdateExpression='SET ecs_task_arn = :a, #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':a': ecs_arn, ':s': 'processing'})
    else:
        table.update_item(Key={'task_id': task_id},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'processing'})
        logger.info(f"[Transform] Launching local worker for task: {task_id}")
        _executor.submit(_run_transform_local, task_id)

    return {
        'success': True,
        'task_id': task_id,
        'run_id': run_id,
        'application_id': app_id,
        'repo': repo_name,
        'transformations_count': len(transform_records),
    }


@router.post("/transform/upload-context", deprecated=True)
async def upload_transform_context(
    task_id: str = Form(...),
    step_index: int = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    """Upload a context file for a specific transformation step."""
    table = _get_tasks_table()
    resp = table.get_item(Key={'task_id': task_id})
    task = resp.get('Item')
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')

    s3_prefix = task.get('s3_prefix', '')
    s3_key = f"{s3_prefix}/context/transformation_{step_index}/{file.filename}"

    s3 = Config.get_boto3_client('s3')
    bucket = Config.S3_ARA_BUCKET
    content = await file.read()
    s3.put_object(Bucket=bucket, Key=s3_key, Body=content)

    # Update task with context file S3 key
    transformations = task.get('transformations', [])
    if step_index < len(transformations):
        files_list = transformations[step_index].get('context_files_s3', [])
        files_list.append(s3_key)
        transformations[step_index]['context_files_s3'] = files_list
        table.update_item(Key={'task_id': task_id},
            UpdateExpression='SET transformations = :t, updated_at = :u',
            ExpressionAttributeValues={':t': transformations, ':u': datetime.now().isoformat()})

    return {'success': True, 's3_key': s3_key}


@router.get("/transform/tasks")
async def list_transform_tasks(
    app_id: Optional[str] = None,
    task_id: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """List transformation tasks."""
    table = _get_tasks_table()
    if task_id:
        resp = table.get_item(Key={'task_id': task_id})
        item = resp.get('Item')
        if not item:
            raise HTTPException(status_code=404, detail='Task not found')
        return {'success': True, 'task': item}

    if app_id:
        all_tasks = _query_tasks_by_app(table, app_id)
        items = [t for t in all_tasks if t.get('task_type') == 'atx_transform']
    else:
        resp = table.scan(FilterExpression='task_type = :tt', ExpressionAttributeValues={':tt': 'atx_transform'}, Limit=200)
        items = sorted(resp.get('Items', []), key=lambda x: x.get('created_at', ''), reverse=True)
    return {'success': True, 'tasks': items}


@router.get("/transform/definitions")
async def get_transform_definitions(user: User = Depends(get_current_user)):
    """Get available ATX transformation definitions via CLI or fallback."""
    import subprocess
    try:
        env = os.environ.copy()
        home = os.path.expanduser('~')
        env['PATH'] = f'{home}/.local/bin:/usr/local/bin:' + env.get('PATH', '')
        result = subprocess.run(['atx', 'custom', 'def', 'list', '--json'], capture_output=True, text=True, timeout=30, env=env)
        if result.returncode == 0:
            # Output has a text line before JSON — find the JSON part
            output = result.stdout
            json_start = output.find('{')
            if json_start >= 0:
                data = json.loads(output[json_start:])
                transformations = [{'name': d.get('name', ''), 'description': d.get('description', ''), 'version': d.get('version', '')} for d in data.get('transformations', [])]
                return {'success': True, 'transformations': transformations}
    except Exception as e:
        logger.warning(f"ATX def list failed: {e}")

    # Fallback — hardcoded known transformations
    return {'success': True, 'transformations': [
        {'name': 'AWS/java-version-upgrade', 'description': 'Upgrade Java version to latest LTS'},
        {'name': 'AWS/spring-boot-upgrade', 'description': 'Upgrade Spring Boot to latest version'},
        {'name': 'AWS/comprehensive-codebase-analysis', 'description': 'Full codebase analysis and documentation'},
        {'name': 'AWS/containerize-application', 'description': 'Containerize application with Docker'},
        {'name': 'AWS/modernize-dependencies', 'description': 'Modernize outdated dependencies'},
    ]}


@router.post("/transform/extract/{task_id}")
async def extract_transformation(task_id: str, user: User = Depends(get_current_user)):
    """Manually trigger Tool 4 extraction for a transformation task."""
    table = _get_tasks_table()
    resp = table.get_item(Key={'task_id': task_id})
    task = resp.get('Item')
    if not task:
        raise HTTPException(status_code=404, detail='Task not found')

    app_id = task['application_id']
    run_id = task.get('run_id', '')
    transformations = task.get('transformations', [])

    from app.strands.tools.atx.extract_atx_transformation import extract_atx_transformation
    result = extract_atx_transformation(task_id, app_id, run_id, transformations)
    return {'success': result.get('success', False), 'result': result}


@router.get("/transform/assessments/{app_id}")
async def get_transformation_assessments(
    app_id: str,
    run_id: Optional[str] = None,
    user: User = Depends(get_current_user),
):
    """Get transformation assessments for an application."""
    from app.services.atx_transformation_assessment_service import ATXTransformationAssessmentService
    svc = ATXTransformationAssessmentService()
    items = svc.get_transformation_assessments(app_id, run_id)
    return {'success': True, 'assessments': items, 'count': len(items)}
