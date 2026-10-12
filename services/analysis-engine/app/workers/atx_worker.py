"""
ATX Worker — runs inside an ECS Fargate container.
Clones a single repo, runs ATX CLI, uploads results to S3,
extracts assessment, and updates task status in DynamoDB.

Also provides ``run_combined()`` for phased multi-repo analysis:
clones all repos, discovers dependency order, runs ATX sequentially
with context chaining between repos.

Environment variables (set by ECS task launcher):
  ATX_TASK_ID, ATX_APP_ID, ATX_REPO_URL, ATX_RUN_ID, ATX_SELECTED_FILES
  GITHUB_TOKEN — injected via ECS secrets for private repo access
"""
import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'),
                    format='%(asctime)s %(name)s %(levelname)s %(message)s')
logger = logging.getLogger('atx-worker')


def main():
    task_id = os.environ.get('ATX_TASK_ID', '')
    app_id = os.environ.get('ATX_APP_ID', '')
    repo_url = os.environ.get('ATX_REPO_URL', '')
    run_id = os.environ.get('ATX_RUN_ID', '')
    selected_files = json.loads(os.environ.get('ATX_SELECTED_FILES', '[]'))

    if not all([task_id, app_id, repo_url, run_id]):
        logger.error("Missing required env vars: ATX_TASK_ID, ATX_APP_ID, ATX_REPO_URL, ATX_RUN_ID")
        sys.exit(1)

    clean_url = repo_url.split('#')[0] if '#' in repo_url else repo_url
    repo_name = clean_url.rstrip('/').split('/')[-1].replace('.git', '')

    logger.info(f"=== ATX Worker Starting ===")
    logger.info(f"  app_id:    {app_id}")
    logger.info(f"  repo:      {repo_name}")
    logger.info(f"  repo_url:  {clean_url}")
    logger.info(f"  run_id:    {run_id}")
    logger.info(f"  task_id:   {task_id}")
    logger.info(f"  files:     {len(selected_files)} context file(s)")
    logger.info(f"  GITHUB_TOKEN: {'set' if os.environ.get('GITHUB_TOKEN') else 'NOT SET'}")
    logger.info(f"  S3_ARA_BUCKET: {os.environ.get('S3_ARA_BUCKET', os.environ.get('S3_ASSETS_BUCKET', 'NOT SET'))}")
    logger.info(f"  BEDROCK_MODEL_ID: {os.environ.get('BEDROCK_MODEL_ID', 'NOT SET')}")

    from app.config import Config
    from app.services.atx_service import ATXService

    svc = ATXService()
    dynamodb = Config.get_boto3_resource('dynamodb')
    table = dynamodb.Table(Config.ATX_PROCESSING_TASKS_TABLE)

    def update_repo_status(status, **kwargs):
        """Update per-repo status in the task record."""
        logger.info(f"[{repo_name}] Status -> {status}")
        repo_status = {'status': status, 'updated_at': datetime.now().isoformat()}
        repo_status.update({k: v for k, v in kwargs.items() if isinstance(v, (str, int, float, bool))})
        try:
            table.update_item(
                Key={'task_id': task_id},
                UpdateExpression='SET updated_at = :t, repo_statuses.#rn = :rs',
                ExpressionAttributeNames={'#rn': repo_name},
                ExpressionAttributeValues={':t': datetime.now().isoformat(), ':rs': repo_status}
            )
        except Exception as e:
            # If repo_statuses map doesn't exist yet, create it
            if 'document path' in str(e).lower():
                try:
                    table.update_item(
                        Key={'task_id': task_id},
                        UpdateExpression='SET updated_at = :t, repo_statuses = :rs',
                        ExpressionAttributeValues={':t': datetime.now().isoformat(), ':rs': {repo_name: repo_status}}
                    )
                except Exception as e2:
                    logger.error(f"Failed to initialize repo_statuses: {e2}")
            else:
                logger.error(f"Failed to update repo status: {e}")

    try:
        # Step 1: Clone
        update_repo_status('cloning')
        from pathlib import Path
        work_dir = str(Path(os.environ.get('ATX_WORKSPACE', '/tmp/atx-workspace')) / app_id / run_id)
        os.makedirs(work_dir, exist_ok=True)
        repo_dir = os.path.join(work_dir, repo_name)

        logger.info(f"[{repo_name}] Cloning {clean_url} to {repo_dir}")
        clone_result = svc._clone_repo(repo_url, repo_dir)
        if not clone_result['success']:
            update_repo_status('failed', error=clone_result['error'])
            logger.error(f"[{repo_name}] Clone failed: {clone_result['error']}")
            sys.exit(1)
        logger.info(f"[{repo_name}] Clone OK (branch: {clone_result.get('branch', 'default')})")

        # Step 2: Prepare context (only if context files selected)
        config_path = None
        if selected_files:
            update_repo_status('preparing')
            build_info = svc._detect_build_system(repo_dir)
            logger.info(f"[{repo_name}] Build system: {build_info['name']}")
            context_dir = os.path.join(repo_dir, 'ApplicationSpecificContext')
            os.makedirs(context_dir, exist_ok=True)
            svc._generate_config_yaml(context_dir, build_info)
            svc._copy_system_prompt(context_dir, selected_files)
            svc._generate_app_insights(context_dir, selected_files)
            config_path = os.path.join(context_dir, 'config.yaml')
            logger.info(f"[{repo_name}] Context prepared with {len(selected_files)} file(s)")
        else:
            logger.info(f"[{repo_name}] No context files — running ATX without -g config")

        # Step 3: Run ATX CLI
        update_repo_status('running_atx')
        atx_cmd_parts = ['atx', 'custom', 'def', 'exec']
        if config_path:
            atx_cmd_parts.extend(['-g', f'file://{config_path}'])
        atx_cmd_parts.extend(['-p', repo_dir, '-n', Config.ATX_TRANSFORMATION_NAME, '-x', '-t'])
        logger.info(f"[{repo_name}] ATX command: {' '.join(atx_cmd_parts)}")
        logger.info(f"[{repo_name}] ATX timeout: {Config.ATX_SHELL_TIMEOUT}s")

        atx_result = svc._run_atx(repo_dir, config_path)
        logger.info(f"[{repo_name}] ATX exit code: {atx_result.get('returncode', '?')}")

        if not atx_result['success']:
            error = atx_result.get('error', 'ATX CLI failed')
            update_repo_status('failed', error=error)
            logger.error(f"[{repo_name}] ATX failed: {error}")
            # Still upload log on failure
            logger.info(f"[{repo_name}] Uploading log despite failure")
            svc._upload_results(repo_dir, app_id, f"{run_id}_{repo_name}")
            sys.exit(1)

        logger.info(f"[{repo_name}] ATX completed, conversation_id: {atx_result.get('conversation_id')}")

        # Step 4: Upload to S3
        update_repo_status('uploading')
        upload_result = svc._upload_results(repo_dir, app_id, f"{run_id}_{repo_name}")
        logger.info(f"[{repo_name}] Uploaded {upload_result.get('uploaded', 0)} files to S3")
        if not upload_result.get('success'):
            update_repo_status('failed', error='S3 upload failed')
            sys.exit(1)

        # Step 5: Extract assessment
        update_repo_status('extracting')
        extract_result = {'success': False, 'error': 'skipped'}
        try:
            from app.services.atx_assessment_service import ATXAssessmentService
            svc_assess = ATXAssessmentService()
            s3_prefix = upload_result.get('s3_prefix', '')
            logger.info(f"[{repo_name}] Extracting assessment from {s3_prefix}")
            extract_result = svc_assess.process_atx_results(app_id, run_id, repo_name, s3_prefix)
            logger.info(f"[{repo_name}] Assessment: {extract_result.get('success')}")
        except Exception as e:
            logger.error(f"[{repo_name}] Assessment extraction failed: {e}")
            extract_result = {'success': False, 'error': str(e)}

        update_repo_status('completed', conversation_id=atx_result.get('conversation_id', ''))
        logger.info(f"=== ATX Worker Completed: {repo_name} ===")

    except Exception as e:
        logger.error(f"[{repo_name}] ATX Worker failed: {e}", exc_info=True)
        update_repo_status('failed', error=str(e))
        sys.exit(1)


def _repo_name_from_url(repo_url: str) -> str:
    """Extract a clean repo name from a URL (strips .git and #branch)."""
    clean_url = repo_url.split('#')[0] if '#' in repo_url else repo_url
    return clean_url.rstrip('/').split('/')[-1].replace('.git', '')


def _extract_summary(repo_dir: str, repo_name: str, build_systems: List[str],
                     languages: List[str]) -> str:
    """Extract a brief summary from ATXDocumentation after ATX completes.

    Reads ``ATXDocumentation/summary.md`` if available, otherwise
    concatenates the first 500 chars of all docs.  Returns a compact
    string describing language, framework, build system, architecture
    role, and key findings.
    """
    docs_dir = Path(repo_dir) / 'ATXDocumentation'
    raw_text = ''

    summary_file = docs_dir / 'summary.md'
    if summary_file.exists():
        try:
            raw_text = summary_file.read_text(encoding='utf-8')[:2000]
        except Exception:
            raw_text = ''

    if not raw_text and docs_dir.exists():
        parts: List[str] = []
        for f in sorted(docs_dir.rglob('*.md')):
            try:
                parts.append(f.read_text(encoding='utf-8'))
            except Exception:
                continue
        raw_text = '\n'.join(parts)[:500]

    lang_str = ', '.join(languages) if languages else 'unknown'
    build_str = ', '.join(build_systems) if build_systems else 'unknown'

    if raw_text:
        # Trim to a reasonable length for context chaining
        trimmed = raw_text[:400].replace('\n', ' ').strip()
        return f"{repo_name} ({lang_str}, {build_str}): {trimmed}"

    return f"{repo_name} ({lang_str}, {build_str}): No summary available"


def _generate_context_config(
    repo_dir: str,
    repo_name: str,
    total_repos: int,
    current_index: int,
    execution_order: List[str],
    dependency_graph: Dict[str, List[str]],
    repo_summaries: Dict[str, str],
    build_info: Dict[str, str],
    selected_files: List[str],
    failed_repos: Optional[List[str]] = None,
) -> str:
    """Generate ``config.yaml`` with ``additionalPlanContext`` for context chaining.

    The generated file is written to ``ApplicationSpecificContext/config.yaml``
    inside *repo_dir* and its path is returned.

    Args:
        repo_dir: Cloned repo directory.
        repo_name: Current repo name.
        total_repos: Total number of repos in the pipeline.
        current_index: 0-based index of the current repo.
        execution_order: Full ordered list of repo names.
        dependency_graph: Adjacency map (A → [B] means A depends on B).
        repo_summaries: Map of repo_name → summary string for completed repos.
        build_info: Build system detection dict with 'build' and 'validate' keys.
        selected_files: Context files selected by the user.
        failed_repos: List of repo names that failed analysis.

    Returns:
        Absolute path to the generated ``config.yaml``.
    """
    failed_repos = failed_repos or []

    # Direct dependencies of the current repo
    direct_deps = dependency_graph.get(repo_name, [])

    # Repos that depend on the current repo (reverse lookup)
    dependents = [
        r for r, deps in dependency_graph.items()
        if repo_name in deps and r != repo_name
    ]

    # Build the additionalPlanContext block
    lines: List[str] = []
    lines.append(
        f"This repository is part of a multi-repo application with "
        f"{total_repos} repositories."
    )
    lines.append(
        f"It is being analyzed in dependency order "
        f"(repo {current_index + 1} of {total_repos})."
    )
    lines.append('')

    if direct_deps:
        lines.append(f"This repo depends on: {', '.join(direct_deps)}")
    if dependents:
        lines.append(f"Repos that depend on this: {', '.join(dependents)}")
    if direct_deps or dependents:
        lines.append('')

    # Summaries of previously analyzed repos
    if repo_summaries:
        lines.append('Previously analyzed repositories:')
        idx = 1
        for prev_repo in execution_order:
            if prev_repo == repo_name:
                break
            summary = repo_summaries.get(prev_repo)
            if summary:
                lines.append(f"  {idx}. {summary}")
                idx += 1

    # Note any failed dependencies
    failed_deps = [d for d in direct_deps if d in failed_repos]
    if failed_deps:
        lines.append('')
        for fd in failed_deps:
            lines.append(
                f"Note: {fd} analysis failed - limited context available"
            )

    lines.append('')
    lines.append(
        'Analyze this repository with awareness of the above context.'
    )
    lines.append(
        'Identify any cross-repo dependencies, shared patterns, '
        'or integration points.'
    )

    plan_context = '\n'.join(lines)

    # Write config.yaml
    context_dir = Path(repo_dir) / 'ApplicationSpecificContext'
    context_dir.mkdir(parents=True, exist_ok=True)

    yaml_lines = [
        f"additionalPlanContext: |\n",
    ]
    for line in plan_context.split('\n'):
        yaml_lines.append(f"  {line}\n")
    yaml_lines.append(f"buildCommand: {build_info.get('build', 'echo no-build-system')}\n")
    yaml_lines.append(f"validationCommands: {build_info.get('validate', 'echo no-tests')}\n")

    config_path = context_dir / 'config.yaml'
    content = ''.join(yaml_lines)
    content = content.encode('ascii', 'replace').decode('ascii')
    config_path.write_text(content, encoding='ascii')

    return str(config_path)


def run_combined(
    task_id: str,
    app_id: str,
    repo_urls: List[str],
    run_id: str,
    selected_files: List[str],
) -> Dict[str, Any]:
    """Phased combined analysis: dependency discovery → sequential ATX per repo.

    This function is the main entry point for the combined worker mode.
    It clones all repos, discovers inter-repo dependencies, then runs
    ATX on each repo in topological order, chaining context from
    previously analyzed repos into each subsequent run.

    Args:
        task_id: DynamoDB task record ID.
        app_id: Application ID.
        repo_urls: List of repo URLs to analyze.
        run_id: Unique run identifier.
        selected_files: S3 keys of user-selected context files.

    Returns:
        Dict with overall results including per-repo statuses.
    """
    from app.config import Config
    from app.services.atx_service import ATXService
    from app.services.dependency_discovery import DependencyDiscoveryService

    svc = ATXService()
    dynamodb = Config.get_boto3_resource('dynamodb')
    table = dynamodb.Table(Config.ATX_PROCESSING_TASKS_TABLE)

    max_resume_attempts = int(os.environ.get('ATX_COMBINED_MAX_RESUME_ATTEMPTS', '5'))

    work_dir = Path(os.environ.get('ATX_WORKSPACE', '/tmp/atx-workspace')) / app_id / run_id
    work_dir.mkdir(parents=True, exist_ok=True)

    # ── helpers ──────────────────────────────────────────────────

    def _update_task(expression: str, names: Dict[str, str],
                     values: Dict[str, Any]) -> None:
        """Update the DynamoDB task record (best-effort)."""
        values[':now'] = datetime.now().isoformat()
        try:
            kwargs: Dict[str, Any] = {
                'Key': {'task_id': task_id},
                'UpdateExpression': f'SET updated_at = :now, {expression}',
                'ExpressionAttributeValues': values,
            }
            if names:
                kwargs['ExpressionAttributeNames'] = names
            table.update_item(**kwargs)
        except Exception as exc:
            logger.error(f"DynamoDB update failed: {exc}")

    def _update_repo_status(repo_name: str, status: str,
                            **extra: Any) -> None:
        """Update per-repo status in the task record."""
        logger.info(f"[{repo_name}] Status -> {status}")
        repo_status: Dict[str, Any] = {
            'status': status,
            'updated_at': datetime.now().isoformat(),
        }
        for k, v in extra.items():
            if isinstance(v, (str, int, float, bool)):
                repo_status[k] = v
        _update_task(
            'repo_statuses.#rn = :rs',
            {'#rn': repo_name},
            {':rs': repo_status},
        )

    # ── Step 1: Clone all repos ─────────────────────────────────

    logger.info(f"[{app_id}] Cloning {len(repo_urls)} repos")
    repo_names: List[str] = []
    repo_name_to_url: Dict[str, str] = {}

    # Initialise repo_statuses map in DynamoDB
    initial_statuses: Dict[str, Dict[str, str]] = {}
    for url in repo_urls:
        rn = _repo_name_from_url(url)
        repo_names.append(rn)
        repo_name_to_url[rn] = url
        initial_statuses[rn] = {
            'status': 'pending',
            'updated_at': datetime.now().isoformat(),
        }

    _update_task(
        'repo_statuses = :rs',
        {},
        {':rs': initial_statuses},
    )

    for rn in repo_names:
        url = repo_name_to_url[rn]
        dest = str(work_dir / rn)
        _update_repo_status(rn, 'cloning')
        clone_result = svc._clone_repo(url, dest)
        if not clone_result['success']:
            _update_repo_status(rn, 'failed', error=clone_result['error'])
            logger.error(f"[{rn}] Clone failed: {clone_result['error']}")

    # ── Step 2: Dependency discovery ────────────────────────────

    logger.info(f"[{app_id}] Running dependency discovery")
    discovery_svc = DependencyDiscoveryService()
    discovery_result = discovery_svc.discover(str(work_dir), repo_names)

    dependency_graph = discovery_result.dependency_graph
    execution_order = discovery_result.execution_order
    mermaid_diagram = discovery_result.mermaid_diagram

    # Store graph, order, mermaid in DynamoDB
    _update_task(
        'dependency_graph = :dg, execution_order = :eo, mermaid_diagram = :md',
        {},
        {
            ':dg': dependency_graph,
            ':eo': execution_order,
            ':md': mermaid_diagram,
        },
    )
    logger.info(f"[{app_id}] Execution order: {execution_order}")

    # ── Step 3: Sequential ATX per repo ─────────────────────────

    repo_summaries: Dict[str, str] = {}
    conversation_ids: Dict[str, str] = {}
    failed_repos: List[str] = []
    results: List[Dict[str, Any]] = []

    for idx, repo_name in enumerate(execution_order):
        repo_dir = str(work_dir / repo_name)

        # Update current position in DynamoDB
        _update_task(
            'current_repo = :cr, current_repo_index = :ci',
            {},
            {':cr': repo_name, ':ci': idx},
        )

        # Skip repos that failed to clone
        if not Path(repo_dir).is_dir():
            logger.warning(f"[{repo_name}] Skipping — directory not found (clone failed?)")
            _update_repo_status(repo_name, 'failed', error='Clone failed')
            failed_repos.append(repo_name)
            results.append({
                'repo_name': repo_name, 'success': False,
                'error': 'Clone failed — directory not found',
            })
            continue

        _update_repo_status(repo_name, 'analyzing')

        # Detect build system
        build_info = svc._detect_build_system(repo_dir)

        # Prepare context / config.yaml
        config_path: Optional[str] = None
        if idx == 0 and not repo_summaries:
            # First repo — use original context files if any
            if selected_files:
                context_dir = Path(repo_dir) / 'ApplicationSpecificContext'
                context_dir.mkdir(parents=True, exist_ok=True)
                svc._generate_config_yaml(str(context_dir), build_info)
                svc._copy_system_prompt(str(context_dir), selected_files)
                svc._generate_app_insights(str(context_dir), selected_files)
                config_path = str(context_dir / 'config.yaml')
        else:
            # Subsequent repos — generate context-chained config.yaml
            repo_metadata = discovery_result.repo_metadata.get(repo_name)
            config_path = _generate_context_config(
                repo_dir=repo_dir,
                repo_name=repo_name,
                total_repos=len(execution_order),
                current_index=idx,
                execution_order=execution_order,
                dependency_graph=dependency_graph,
                repo_summaries=repo_summaries,
                build_info=build_info,
                selected_files=selected_files,
                failed_repos=failed_repos,
            )
            # Also copy system prompt / app insights if available
            if selected_files:
                context_dir = Path(repo_dir) / 'ApplicationSpecificContext'
                context_dir.mkdir(parents=True, exist_ok=True)
                svc._copy_system_prompt(str(context_dir), selected_files)
                svc._generate_app_insights(str(context_dir), selected_files)

        # Run ATX with auto-resume
        atx_result: Dict[str, Any] = {}
        attempt = 0
        conversation_id: Optional[str] = None

        while attempt < max_resume_attempts:
            attempt += 1
            logger.info(
                f"[{repo_name}] ATX attempt {attempt}/{max_resume_attempts}"
            )

            if conversation_id:
                atx_result = svc._run_atx_resume(repo_dir, conversation_id)
            else:
                atx_result = svc._run_atx(repo_dir, config_path)

            new_cid = atx_result.get('conversation_id')
            if new_cid:
                conversation_id = new_cid

            if atx_result.get('success'):
                break

            # If not resumable, no point retrying
            if not atx_result.get('resumable') and not conversation_id:
                logger.warning(f"[{repo_name}] ATX failed and not resumable")
                break

            logger.info(
                f"[{repo_name}] ATX failed (attempt {attempt}), "
                f"will resume with conversation_id={conversation_id}"
            )

        # Store conversation_id
        if conversation_id:
            conversation_ids[repo_name] = conversation_id
            _update_task(
                'conversation_ids.#rn = :cid',
                {'#rn': repo_name},
                {':cid': conversation_id},
            )

        if not atx_result.get('success'):
            error = atx_result.get('error', 'ATX failed after all attempts')
            _update_repo_status(repo_name, 'failed', error=error)
            failed_repos.append(repo_name)
            # Still upload whatever we have
            svc._upload_results(repo_dir, app_id, f"{run_id}_{repo_name}")
            results.append({
                'repo_name': repo_name, 'success': False, 'error': error,
                'conversation_id': conversation_id,
            })
            # Add failure note to summaries so dependent repos know
            repo_summaries[repo_name] = (
                f"{repo_name}: Analysis FAILED — {error}"
            )
            continue

        # Upload results
        upload_result = svc._upload_results(
            repo_dir, app_id, f"{run_id}_{repo_name}"
        )

        # Extract summary for context chaining (Task 4)
        repo_meta = discovery_result.repo_metadata.get(repo_name)
        languages = repo_meta.languages if repo_meta else []
        build_systems = repo_meta.build_systems if repo_meta else []
        summary = _extract_summary(repo_dir, repo_name, build_systems, languages)
        repo_summaries[repo_name] = summary

        # Store summary in DynamoDB
        try:
            _update_task(
                'repo_summaries.#rn = :sm',
                {'#rn': repo_name},
                {':sm': summary},
            )
        except Exception:
            # repo_summaries map may not exist yet — initialize and retry
            try:
                _update_task(
                    'repo_summaries = if_not_exists(repo_summaries, :empty)',
                    {},
                    {':empty': {}},
                )
                _update_task(
                    'repo_summaries.#rn = :sm',
                    {'#rn': repo_name},
                    {':sm': summary},
                )
            except Exception as e2:
                logger.error(f'DynamoDB update failed for repo_summaries: {e2}')

        _update_repo_status(
            repo_name, 'completed',
            conversation_id=conversation_id or '',
        )

        results.append({
            'repo_name': repo_name,
            'success': True,
            'conversation_id': conversation_id,
            'upload': upload_result,
            'summary': summary,
        })

        logger.info(f"[{repo_name}] Completed ({idx + 1}/{len(execution_order)})")

    # ── Final summary ───────────────────────────────────────────

    completed = sum(1 for r in results if r.get('success'))
    failed = sum(1 for r in results if not r.get('success'))

    logger.info(
        f"[{app_id}] Combined analysis done: "
        f"{completed} completed, {failed} failed out of {len(execution_order)}"
    )

    return {
        'success': failed == 0,
        'app_id': app_id,
        'run_id': run_id,
        'total_repos': len(execution_order),
        'completed_repos': completed,
        'failed_repos': failed,
        'execution_order': execution_order,
        'dependency_graph': dependency_graph,
        'mermaid_diagram': mermaid_diagram,
        'results': results,
        'repo_summaries': repo_summaries,
        'conversation_ids': conversation_ids,
    }


if __name__ == '__main__':
    if '--combined' in sys.argv or os.environ.get('ATX_MODE') == 'combined':
        # Combined mode: read repo URLs from env and run phased analysis
        task_id = os.environ.get('ATX_TASK_ID', '')
        app_id = os.environ.get('ATX_APP_ID', '')
        repo_urls = json.loads(os.environ.get('ATX_REPO_URLS', '[]'))
        run_id = os.environ.get('ATX_RUN_ID', '')
        selected_files = json.loads(os.environ.get('ATX_SELECTED_FILES', '[]'))
        if not all([task_id, app_id, repo_urls, run_id]):
            logger.error("Missing required env vars for combined mode")
            sys.exit(1)
        run_combined(task_id, app_id, repo_urls, run_id, selected_files)
    else:
        main()
