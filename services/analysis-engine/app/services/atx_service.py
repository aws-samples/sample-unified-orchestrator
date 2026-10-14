"""ATX Code Analysis Service — clones repos, runs ATX CLI, uploads results."""
import os
import logging
import uuid
import shutil
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

import boto3
from app.config import Config

logger = logging.getLogger(__name__)

# Build system detection patterns
BUILD_SYSTEMS = {
    'maven': {'files': ['pom.xml'], 'build': 'mvn clean install -DskipTests', 'validate': 'mvn test'},
    'gradle': {'files': ['build.gradle', 'build.gradle.kts'], 'build': './gradlew build -x test', 'validate': './gradlew test'},
    'npm': {'files': ['package.json'], 'build': 'npm install && npm run build', 'validate': 'npm test'},
    'dotnet': {'files': ['*.csproj', '*.sln'], 'build': 'dotnet build', 'validate': 'dotnet test'},
    'python': {'files': ['setup.py', 'pyproject.toml', 'requirements.txt'], 'build': 'pip install -e .', 'validate': 'pytest'},
    'terraform': {'files': ['main.tf'], 'build': 'terraform init', 'validate': 'terraform validate'},
    'perl': {'files': ['Makefile.PL', 'Build.PL'], 'build': 'perl Makefile.PL && make', 'validate': 'make test'},
}

# Java version to JAVA_HOME mapping (Amazon Corretto paths in container)
JAVA_HOME_MAP = {
    '8': '/usr/lib/jvm/java-1.8.0-amazon-corretto',
    '11': '/usr/lib/jvm/java-11-amazon-corretto',
    '17': '/usr/lib/jvm/java-17-amazon-corretto',
    '21': '/usr/lib/jvm/java-21-amazon-corretto',
}

# Python version to binary mapping
PYTHON_BIN_MAP = {
    '3.9': 'python3.9',
    '3.10': 'python3.10',
    '3.11': 'python3.11',
    '3.12': 'python3.12',
    '3.13': 'python3.13',
}


class ATXService:
    """Service for running ATX code analysis on application repositories."""

    def __init__(self):
        self.s3_bucket = Config.S3_ARA_BUCKET
        self.notes_bucket = Config.S3_UNO_DP_BUCKET
        self.applications_table = Config.APPLICATIONS_TABLE
        self.temp_base = Path(os.environ.get('ATX_WORKSPACE', '/tmp/atx-workspace'))
        self.temp_base.mkdir(parents=True, exist_ok=True)

    def get_application(self, app_id: str) -> Optional[Dict[str, Any]]:
        """Get application data including SCM_URLS."""
        dynamodb = Config.get_boto3_resource('dynamodb')
        table = dynamodb.Table(self.applications_table)
        resp = table.get_item(Key={'application_id': str(app_id)})
        return resp.get('Item')

    def get_relevant_files(self, app_id: str) -> List[Dict[str, Any]]:
        """Get relevant notes files for an application from S3."""
        if not self.notes_bucket:
            logger.warning("S3_UNO_DP_BUCKET not configured, cannot load context files")
            return []
        s3 = Config.get_boto3_client('s3')
        relevant = []
        note_types = {
            'decisions': 'Architecture Decision',
            'application-insights': 'Application Insights',
            'discovery-notes': 'Discovery Notes',
            'atx-common-guidelines': 'ATX Common Guidelines',
        }
        for s3_path, note_type in note_types.items():
            # App-specific files (folder = application_id)
            app_prefix = f'notes/{s3_path}/{app_id}/'
            try:
                resp = s3.list_objects_v2(Bucket=self.notes_bucket, Prefix=app_prefix)
                for obj in resp.get('Contents', []):
                    relevant.append({
                        'key': obj['Key'], 'note_type': note_type, 'scope': 'application',
                        'size': obj['Size'], 'last_modified': obj['LastModified'].isoformat()
                    })
            except Exception as e:
                logger.warning(f"Error listing {app_prefix}: {e}")

            # Global files (ALL)
            if note_type in ['Architecture Decision', 'ATX Common Guidelines']:
                global_prefix = f'notes/{s3_path}/all/'
                try:
                    resp = s3.list_objects_v2(Bucket=self.notes_bucket, Prefix=global_prefix)
                    for obj in resp.get('Contents', []):
                        relevant.append({
                            'key': obj['Key'], 'note_type': note_type, 'scope': 'global',
                            'size': obj['Size'], 'last_modified': obj['LastModified'].isoformat()
                        })
                except Exception as e:
                    logger.warning(f"Error listing {global_prefix}: {e}")

        return relevant

    def _detect_build_system(self, repo_path: str) -> Dict[str, str]:
        """Auto-detect build system from repo contents."""
        root = Path(repo_path)
        for name, info in BUILD_SYSTEMS.items():
            for pattern in info['files']:
                if '*' in pattern:
                    if list(root.glob(pattern)):
                        return {'name': name, 'build': info['build'], 'validate': info['validate']}
                elif (root / pattern).exists():
                    return {'name': name, 'build': info['build'], 'validate': info['validate']}
        return {'name': 'unknown', 'build': 'echo no-build-system', 'validate': 'echo no-tests'}

    def _download_note_content(self, file_key: str) -> str:
        """Download a note file from S3 and return its content."""
        s3 = Config.get_boto3_client('s3')
        try:
            resp = s3.get_object(Bucket=self.notes_bucket, Key=file_key)
            return resp['Body'].read().decode('utf-8')
        except Exception as e:
            logger.error(f"Failed to download {file_key}: {e}")
            return ''

    def _generate_config_yaml(self, context_dir: str, build_info: Dict[str, str],
                              context_text: str = '', target_version: str = '') -> str:
        """Generate config.yaml for ATX CLI.

        Args:
            context_dir: Path to ApplicationSpecificContext directory.
            build_info: Detected build system info (name, build, validate).
            context_text: Additional plan context from the user (required for transforms).
            target_version: Target runtime version (e.g., '21' for Java, '3.13' for Python).
        """
        ctx_path = os.path.dirname(context_dir)
        plan_context = (
            f'IMPORTANT: Inspect {ctx_path}/ApplicationSpecificContext before planning. '
            f'Use file name ended with "common-guidelines.md" if present in {ctx_path}/ApplicationSpecificContext as common guidelines for the transformation/analysis. '
            f'Use file name ended with "app-insights.md"  if present {ctx_path}/ApplicationSpecificContext for additional insights for the transformation/analysis.'
        )
        if context_text:
            plan_context += f' Additional Information: {context_text}'

        # Build command with target version JAVA_HOME/Python prefix
        build_cmd = build_info['build']
        validate_cmd = build_info['validate']

        if target_version:
            build_system = build_info.get('name', '')
            if build_system in ('maven', 'gradle') and target_version in JAVA_HOME_MAP:
                java_home = JAVA_HOME_MAP[target_version]
                java_prefix = f'export JAVA_HOME={java_home} && export PATH=$JAVA_HOME/bin:$PATH && '
                build_cmd = java_prefix + build_cmd
                validate_cmd = java_prefix + validate_cmd
            elif build_system == 'python' and target_version in PYTHON_BIN_MAP:
                python_bin = PYTHON_BIN_MAP[target_version]
                build_cmd = f'{python_bin} -m pip install -e .'
                validate_cmd = f'{python_bin} -m pytest'

        # Use single quotes for YAML string to avoid nested quote issues
        lines = [
            f"additionalPlanContext: '{plan_context}'",
            f'buildCommand: {build_cmd}',
            f'validationCommands: {validate_cmd}',
            '',
        ]
        config_path = os.path.join(context_dir, 'config.yaml')
        content = '\n'.join(lines)
        content = content.encode('ascii', 'replace').decode('ascii')
        with open(config_path, 'w', encoding='ascii') as f:
            f.write(content)
        return config_path

    def _generate_app_insights(self, context_dir: str, selected_files: List[str]) -> str:
        """Generate app-insights.md from selected note files (excluding ATX Common Guidelines)."""
        insights_path = os.path.join(context_dir, 'app-insights.md')
        with open(insights_path, 'w') as f:
            f.write('# Application Insights\n\n')
            for file_key in selected_files:
                if 'atx-common-guidelines' in file_key:
                    continue  # handled by _copy_system_prompt
                content = self._download_note_content(file_key)
                if content:
                    filename = file_key.split('/')[-1]
                    f.write(f'## {filename}\n\n{content}\n\n---\n\n')
        return insights_path

    def _copy_system_prompt(self, context_dir: str, selected_files: List[str]) -> str:
        """Download ATX Common Guidelines from S3 into atx-system-prompt.md."""
        dest = os.path.join(context_dir, 'atx-system-prompt.md')
        content_parts = []
        for file_key in selected_files:
            if 'atx-common-guidelines' in file_key:
                content = self._download_note_content(file_key)
                if content:
                    content_parts.append(content)
        if content_parts:
            with open(dest, 'w') as f:
                f.write('\n\n---\n\n'.join(content_parts))
        else:
            with open(dest, 'w') as f:
                f.write('# ATX System Prompt\n\nFollow standard transformation guidelines.\n')
        return dest

    def _ensure_gitignore_entry(self, repo_dir: str, entry: str) -> None:
        """Append *entry* to the repo's ``.gitignore`` if not already present."""
        gitignore_path = os.path.join(repo_dir, '.gitignore')
        try:
            existing = ''
            if os.path.exists(gitignore_path):
                with open(gitignore_path, 'r') as f:
                    existing = f.read()
            # Check if entry is already listed (as a whole line)
            if entry not in {line.strip() for line in existing.splitlines()}:
                with open(gitignore_path, 'a') as f:
                    if existing and not existing.endswith('\n'):
                        f.write('\n')
                    f.write(f'{entry}\n')
                logger.info(f"Added '{entry}' to .gitignore in {repo_dir}")
        except Exception as e:
            logger.warning(f"Failed to update .gitignore in {repo_dir}: {e}")

    def _clone_repo(self, repo_url: str, dest_dir: str) -> Dict[str, Any]:
        """Clone a git repository. Supports branch via url#branch format."""
        from app.utils.repo_validation import split_and_validate

        token = Config.GITHUB_TOKEN or ''

        # Parse and validate branch/URL (format: https://github.com/org/repo.git#branch).
        # Untrusted input — allow-list scheme/host, reject option-injection, constrain branch.
        try:
            clean_url, branch = split_and_validate(repo_url)
        except ValueError as e:
            logger.error(f"Rejected repo URL {repo_url!r}: {e}")
            return {'success': False, 'error': f'Invalid repo URL/branch: {e}'}

        clone_url = clean_url
        if token and clean_url.startswith('https://'):
            clone_url = clean_url.replace('https://', f'https://{token}@')

        cmd = ['git', 'clone', '--depth', '1']
        if branch:
            cmd.extend(['-b', branch])
        # '--' ends option parsing so URL/dest can never be read as flags.
        cmd.extend(['--', clone_url, dest_dir])

        logger.info(f"Cloning {clean_url} (branch: {branch or 'default'}) to {dest_dir}")
        try:
            # Remove existing directory to avoid "already exists" errors on retry
            if os.path.exists(dest_dir):
                shutil.rmtree(dest_dir)
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                logger.error(f"Clone failed: {result.stderr.strip()}")
                return {'success': False, 'error': result.stderr.strip()}
            logger.info(f"Clone successful: {dest_dir}")
            return {'success': True, 'path': dest_dir, 'branch': branch or 'default'}
        except subprocess.TimeoutExpired:
            logger.error(f"Clone timed out for {clean_url}")
            return {'success': False, 'error': 'Clone timed out (5 min)'}
        except Exception as e:
            logger.error(f"Clone exception: {e}")
            return {'success': False, 'error': str(e)}

    def _run_atx(self, repo_path: str, config_path: str = None, transformation_name: str = None) -> Dict[str, Any]:
        """Run ATX CLI on a cloned repo. Log file is written inside the repo folder."""
        import re as _re

        t_name = transformation_name or Config.ATX_TRANSFORMATION_NAME
        cmd = [
            'atx', 'custom', 'def', 'exec',
            '-p', repo_path,
            '-n', t_name,
            '-x', '-t'
        ]
        if config_path and os.path.exists(config_path):
            # Confirm the config path resolves inside the repo dir (no traversal/injection).
            from app.utils.repo_validation import validate_config_path
            try:
                safe_config = validate_config_path(config_path, repo_path)
            except ValueError as e:
                logger.error(f"Rejected ATX config path {config_path!r}: {e}")
                return {'success': False, 'error': f'Invalid config path: {e}'}
            cmd.insert(4, '-g')
            cmd.insert(5, f'file://{safe_config}')
        logger.info(f"Running ATX: {' '.join(cmd)}")

        env = os.environ.copy()
        home = os.path.expanduser('~')
        extra_paths = [f'{home}/.local/bin', '/root/.local/bin', '/usr/local/bin']
        env['PATH'] = ':'.join(extra_paths) + ':' + env.get('PATH', '')

        log_file = os.path.join(repo_path, 'atx-run.log')
        timeout_seconds = Config.ATX_SHELL_TIMEOUT  # from env, default 36000 (10 hrs)

        try:
            logger.info(f"ATX log file: {log_file} (timeout: {timeout_seconds}s)")
            with open(log_file, 'w') as lf:
                proc = subprocess.Popen(
                    cmd, stdout=lf, stderr=subprocess.STDOUT, cwd=repo_path, env=env
                )
                proc.wait(timeout=timeout_seconds)

            with open(log_file, 'r') as lf:
                output = lf.read()

            # Extract conversation ID from output for resume capability
            conversation_id = None
            conv_match = _re.search(r'--conversation-id\s+(\S+)', output)
            if conv_match:
                conversation_id = conv_match.group(1)

            logger.info(f"ATX exit code: {proc.returncode}, conversation_id: {conversation_id}")
            if output:
                logger.info(f"ATX output (last 500): {output[-500:]}")

            return {
                'success': proc.returncode == 0,
                'stdout': output[-2000:] if output else '',
                'stderr': '',
                'returncode': proc.returncode,
                'log_file': log_file,
                'conversation_id': conversation_id,
                'resumable': conversation_id is not None
            }
        except subprocess.TimeoutExpired:
            proc.kill()
            conversation_id = None
            try:
                with open(log_file, 'r') as lf:
                    output = lf.read()
                conv_match = _re.search(r'--conversation-id\s+(\S+)', output)
                if conv_match:
                    conversation_id = conv_match.group(1)
            except Exception:
                output = ''
            logger.error(f"ATX timed out ({timeout_seconds}s), conversation_id: {conversation_id}")
            return {
                'success': False,
                'error': f'ATX timed out ({timeout_seconds // 60} min)',
                'log_file': log_file,
                'conversation_id': conversation_id,
                'resumable': conversation_id is not None
            }
        except FileNotFoundError:
            logger.error("ATX CLI not found in PATH")
            return {'success': False, 'error': 'ATX CLI not installed. Run: pip install atx'}
        except Exception as e:
            logger.error(f"ATX exception: {e}", exc_info=True)
            return {'success': False, 'error': str(e)}

    def _upload_results(self, repo_path: str, app_id: str, run_id: str) -> Dict[str, Any]:
        """Upload ATXDocumentation/ and atx-run.log to S3 under per-repo prefix."""
        s3 = Config.get_boto3_client('s3')
        uploaded = 0
        repo_name = os.path.basename(repo_path)
        s3_prefix = f'atx-results/{app_id}/{run_id}'

        # Upload ATXDocumentation/
        docs_dir = os.path.join(repo_path, 'ATXDocumentation')
        if os.path.exists(docs_dir):
            for root, _, files in os.walk(docs_dir):
                for fname in files:
                    local_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(local_path, docs_dir)
                    s3_key = f'{s3_prefix}/ATXDocumentation/{rel_path}'
                    try:
                        s3.upload_file(local_path, self.s3_bucket, s3_key)
                        uploaded += 1
                    except Exception as e:
                        logger.error(f"Failed to upload {s3_key}: {e}")
        else:
            logger.warning(f"ATXDocumentation not found in {repo_path}")

        # Upload atx-run.log
        log_file = os.path.join(repo_path, 'atx-run.log')
        if os.path.exists(log_file):
            s3_key = f'{s3_prefix}/atx-run.log'
            try:
                s3.upload_file(log_file, self.s3_bucket, s3_key)
                uploaded += 1
            except Exception as e:
                logger.error(f"Failed to upload log: {e}")

        logger.info(f"Uploaded {uploaded} files to s3://{self.s3_bucket}/{s3_prefix}/")
        return {'success': uploaded > 0, 'uploaded': uploaded, 's3_prefix': s3_prefix, 'repo_name': repo_name}

    def _process_single_repo(self, app_id: str, repo_url: str, work_dir: str,
                              selected_files: List[str], run_id: str, index: int, total: int) -> Dict[str, Any]:
        """Process a single repo — clone, prepare context, run ATX, upload, extract assessment."""
        clean_url = repo_url.split('#')[0] if '#' in repo_url else repo_url
        repo_name = clean_url.rstrip('/').split('/')[-1].replace('.git', '')
        repo_dir = os.path.join(work_dir, repo_name)

        logger.info(f"[{app_id}] Cloning {repo_url} ({index+1}/{total})")
        clone_result = self._clone_repo(repo_url, repo_dir)
        if not clone_result['success']:
            return {'repo': repo_url, 'repo_name': repo_name, 'success': False, 'error': clone_result['error']}

        build_info = self._detect_build_system(repo_dir)
        logger.info(f"[{app_id}] Detected build system: {build_info['name']} for {repo_name}")

        config_path = None
        if selected_files:
            context_dir = os.path.join(repo_dir, 'ApplicationSpecificContext')
            os.makedirs(context_dir, exist_ok=True)
            self._generate_config_yaml(context_dir, build_info)
            self._copy_system_prompt(context_dir, selected_files)
            self._generate_app_insights(context_dir, selected_files)
            config_path = os.path.join(context_dir, 'config.yaml')
            logger.info(f"[{app_id}] Context prepared with {len(selected_files)} file(s)")
        else:
            logger.info(f"[{app_id}] No context files — running ATX without -g config")

        logger.info(f"[{app_id}] Running ATX on {repo_name}")
        atx_result = self._run_atx(repo_dir, config_path)

        upload_result = self._upload_results(repo_dir, app_id, f"{run_id}_{repo_name}")

        # Tool 2: Extract assessment immediately if ATX succeeded and upload has ATXDocumentation
        extract_result = None
        if atx_result['success'] and upload_result.get('success'):
            try:
                from app.services.atx_assessment_service import ATXAssessmentService
                svc = ATXAssessmentService()
                s3_prefix = upload_result.get('s3_prefix', '')
                extract_result = svc.process_atx_results(app_id, run_id, repo_name, s3_prefix)
                logger.info(f"[{app_id}] Assessment extracted for {repo_name}: {extract_result.get('success')}")
            except Exception as e:
                logger.error(f"[{app_id}] Assessment extraction failed for {repo_name}: {e}")
                extract_result = {'success': False, 'error': str(e)}

        return {
            'repo': repo_url,
            'repo_name': repo_name,
            'build_system': build_info['name'],
            'atx_success': atx_result['success'],
            'atx_error': atx_result.get('error', atx_result.get('stderr', '')),
            'conversation_id': atx_result.get('conversation_id'),
            'resumable': atx_result.get('resumable', False),
            'upload': upload_result,
            'extract': extract_result
        }

    def run_analysis(self, app_id: str, selected_files: List[str], selected_repos: List[str] = None) -> Dict[str, Any]:
        """Run full ATX code analysis for an application (repos in parallel)."""
        from concurrent.futures import ThreadPoolExecutor, as_completed

        run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        work_dir = str(self.temp_base / app_id / run_id)
        os.makedirs(work_dir, exist_ok=True)

        try:
            app = self.get_application(app_id)
            if not app:
                return {'success': False, 'error': f'Application {app_id} not found'}

            all_urls = app.get('scm_urls') or app.get('SCM_URLS') or []
            # Use selected_repos if provided, otherwise all
            scm_urls = selected_repos if selected_repos else all_urls
            if not scm_urls:
                return {'success': False, 'error': f'No SCM_URLS for application {app_id}'}

            app_name = app.get('application_name', app_id)
            results = []

            # Run repos in parallel
            with ThreadPoolExecutor(max_workers=min(len(scm_urls), 4)) as executor:
                futures = {
                    executor.submit(
                        self._process_single_repo, app_id, url, work_dir,
                        selected_files, run_id, i, len(scm_urls)
                    ): url for i, url in enumerate(scm_urls)
                }
                for future in as_completed(futures):
                    try:
                        results.append(future.result())
                    except Exception as e:
                        results.append({'repo': futures[future], 'success': False, 'error': str(e)})

            return {
                'success': True,
                'app_id': app_id,
                'app_name': app_name,
                'run_id': run_id,
                'repos_analyzed': len(results),
                'results': results
            }

        except Exception as e:
            logger.error(f"ATX analysis failed for {app_id}: {e}", exc_info=True)
            return {'success': False, 'app_id': app_id, 'error': str(e), 'work_dir': work_dir}
        finally:
            logger.info(f"[{app_id}] Work directory preserved at: {work_dir}")

    def _run_atx_resume(self, repo_path: str, conversation_id: str) -> Dict[str, Any]:
        """Resume an ATX run using conversation ID."""
        import re as _re
        cmd = ['atx', '--conversation-id', conversation_id, '-t']
        logger.info(f"Resuming ATX: {' '.join(cmd)}")

        env = os.environ.copy()
        home = os.path.expanduser('~')
        env['PATH'] = f'{home}/.local/bin:/root/.local/bin:/usr/local/bin:' + env.get('PATH', '')

        log_file = os.path.join(repo_path, 'atx-resume.log')
        timeout_seconds = Config.ATX_SHELL_TIMEOUT

        try:
            with open(log_file, 'w') as lf:
                proc = subprocess.Popen(cmd, stdout=lf, stderr=subprocess.STDOUT, cwd=repo_path, env=env)
                proc.wait(timeout=timeout_seconds)
            with open(log_file, 'r') as lf:
                output = lf.read()
            new_cid = None
            m = _re.search(r'--conversation-id\s+(\S+)', output)
            if m:
                new_cid = m.group(1)
            return {'success': proc.returncode == 0, 'stdout': output[-2000:], 'log_file': log_file, 'conversation_id': new_cid}
        except subprocess.TimeoutExpired:
            proc.kill()
            return {'success': False, 'error': f'Resume timed out ({timeout_seconds // 60} min)', 'log_file': log_file}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def run_analysis_with_resume(self, app_id: str, selected_files: List[str], selected_repos: List[str], conversation_ids: Dict[str, str]) -> Dict[str, Any]:
        """Run ATX analysis, resuming repos that have conversation IDs."""
        from concurrent.futures import ThreadPoolExecutor, as_completed

        run_id = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        work_dir = str(self.temp_base / app_id / run_id)
        os.makedirs(work_dir, exist_ok=True)

        app = self.get_application(app_id)
        if not app:
            return {'success': False, 'error': f'Application {app_id} not found'}

        all_urls = app.get('scm_urls') or app.get('SCM_URLS') or []
        scm_urls = selected_repos if selected_repos else all_urls
        results = []

        for i, url in enumerate(scm_urls):
            clean_url = url.split('#')[0] if '#' in url else url
            repo_name = clean_url.rstrip('/').split('/')[-1].replace('.git', '')
            repo_dir = os.path.join(work_dir, repo_name)
            cid = conversation_ids.get(repo_name)

            if cid:
                logger.info(f"[{app_id}] Resuming {repo_name} with conversation {cid}")
                os.makedirs(repo_dir, exist_ok=True)
                atx_result = self._run_atx_resume(repo_dir, cid)
            else:
                logger.info(f"[{app_id}] Fresh run for {repo_name}")
                result = self._process_single_repo(app_id, url, work_dir, selected_files, run_id, i, len(scm_urls))
                results.append(result)
                continue

            upload_result = self._upload_results(repo_dir, app_id, f"{run_id}_{repo_name}")
            results.append({
                'repo': url, 'repo_name': repo_name, 'build_system': 'resumed',
                'atx_success': atx_result['success'],
                'atx_error': atx_result.get('error', ''),
                'conversation_id': atx_result.get('conversation_id', cid),
                'upload': upload_result
            })

        return {'success': True, 'app_id': app_id, 'run_id': run_id, 'repos_analyzed': len(results), 'results': results}
