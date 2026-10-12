"""
ATX Transform Worker — runs a sequential transformation pipeline.
All transformations run on the same cloned repo in order.
Each step's output is the next step's input.

Usage:
  python -m app.workers.atx_transform_worker <task_id>
  Or via env: ATX_TRANSFORM_TASK_ID=<task_id>
"""
import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path

logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'),
                    format='%(asctime)s %(name)s %(levelname)s %(message)s')
logger = logging.getLogger('atx-transform-worker')


def run_transform_pipeline(task_id: str):
    from app.config import Config
    from app.services.atx_service import ATXService

    svc = ATXService()
    dynamodb = Config.get_boto3_resource('dynamodb')
    table = dynamodb.Table(Config.ATX_PROCESSING_TASKS_TABLE)
    s3 = Config.get_boto3_client('s3')
    bucket = Config.S3_ARA_BUCKET

    # Load task
    resp = table.get_item(Key={'task_id': task_id})
    task = resp.get('Item')
    if not task:
        logger.error(f"Task {task_id} not found")
        return

    app_id = task['application_id']
    repo_url = task['repo_url']
    branch = task.get('branch', '')
    run_id = task['run_id']
    s3_prefix = task['s3_prefix']
    transformations = task.get('transformations', [])
    repo_name = task.get('repo_name', repo_url.split('/')[-1].replace('.git', ''))

    logger.info(f"=== Transform Pipeline Starting ===")
    logger.info(f"  task_id: {task_id}")
    logger.info(f"  app_id: {app_id}")
    logger.info(f"  repo: {repo_name} ({repo_url})")
    logger.info(f"  branch: {branch or 'default'}")
    logger.info(f"  transformations: {len(transformations)}")
    logger.info(f"  GITHUB_TOKEN: {'set' if Config.GITHUB_TOKEN else 'NOT SET'}")

    def update_step(idx, status, **extra):
        logger.info(f"[{repo_name}] Transformation {idx} -> {status}")
        transformations[idx]['status'] = status
        transformations[idx]['updated_at'] = datetime.now().isoformat()
        for k, v in extra.items():
            transformations[idx][k] = v
        table.update_item(Key={'task_id': task_id},
            UpdateExpression='SET transformations = :t, updated_at = :u',
            ExpressionAttributeValues={':t': transformations, ':u': datetime.now().isoformat()})

    def update_task_status(status):
        table.update_item(Key={'task_id': task_id},
            UpdateExpression='SET #s = :s, updated_at = :u',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': status, ':u': datetime.now().isoformat()})

    # Clone repo once
    work_dir = str(Path(os.environ.get('ATX_WORKSPACE', '/tmp/atx-workspace')) / app_id / run_id)
    os.makedirs(work_dir, exist_ok=True)
    repo_dir = os.path.join(work_dir, repo_name)

    # Strip any existing #branch from repo URL — user provides branch separately.
    # Untrusted input — allow-list scheme/host and constrain the branch name.
    from app.utils.repo_validation import validate_repo_url, validate_branch
    try:
        clean_repo_url = validate_repo_url(repo_url.split('#')[0])
        safe_branch = validate_branch(branch) if branch else None
    except ValueError as e:
        logger.error(f"[{repo_name}] Rejected repo URL/branch: {e}")
        for i in range(len(transformations)):
            update_step(i, 'failed', error=f'Invalid repo URL/branch: {e}')
        update_task_status('failed')
        return
    branch = safe_branch or branch
    logger.info(f"[{repo_name}] Cloning {clean_repo_url} (full clone for push)")

    # Full clone (not shallow) so we can push later
    import subprocess
    token = Config.GITHUB_TOKEN or ''
    clone_url = clean_repo_url
    if token and clean_repo_url.startswith('https://'):
        clone_url = clean_repo_url.replace('https://', f'https://{token}@')
    try:
        clone_cmd = ['git', 'clone']
        if safe_branch:
            clone_cmd.extend(['-b', safe_branch])
        # '--' ends option parsing so URL/dest can never be read as flags.
        clone_cmd.extend(['--', clone_url, repo_dir])
        result = subprocess.run(clone_cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            error = result.stderr.strip()
            logger.error(f"Clone failed: {error}")
            for i in range(len(transformations)):
                update_step(i, 'failed', error='Clone failed: ' + error)
            update_task_status('failed')
            return
    except Exception as e:
        logger.error(f"Clone exception: {e}")
        for i in range(len(transformations)):
            update_step(i, 'failed', error=str(e))
        update_task_status('failed')
        return
    logger.info(f"[{repo_name}] Clone OK")

    # If branch was specified, we're already on it from the clone.
    # If clone failed because branch doesn't exist, create it.
    if branch:
        import subprocess as _sp
        try:
            # Verify we're on the right branch
            current = _sp.run(['git', 'branch', '--show-current'], capture_output=True, text=True, cwd=repo_dir)
            if current.stdout.strip() != branch:
                # Branch didn't exist remotely — create it
                logger.info(f"[{repo_name}] Creating branch: {branch}")
                _sp.run(['git', 'checkout', '-b', branch], capture_output=True, text=True, cwd=repo_dir, check=True)
            logger.info(f"[{repo_name}] On branch: {branch}")
        except Exception as e:
            error = f"Branch setup failed: {e}"
            logger.error(f"[{repo_name}] {error}")
            for i in range(len(transformations)):
                update_step(i, 'failed', error=error)
            update_task_status('failed')
            return

    # Run each transformation sequentially
    for idx, t in enumerate(transformations):
        t_name = t['name']
        logger.info(f"[{repo_name}] === Transformation {idx}: {t_name} ===")
        update_step(idx, 'running')

        # Download context files for this step
        context_files = t.get('context_files_s3', [])
        context_dir = os.path.join(repo_dir, 'ApplicationSpecificContext')
        os.makedirs(context_dir, exist_ok=True)

        if context_files:
            notes_bucket = Config.S3_UNO_DP_BUCKET
            logger.info(f"[{repo_name}] Downloading {len(context_files)} context note(s) from {notes_bucket}")
            for s3_key in context_files:
                fname = s3_key.split('/')[-1]
                local_path = os.path.join(context_dir, fname)
                try:
                    src_bucket = notes_bucket if notes_bucket else bucket
                    resp = s3.get_object(Bucket=src_bucket, Key=s3_key)
                    with open(local_path, 'wb') as f:
                        f.write(resp['Body'].read())
                    logger.info(f"[{repo_name}] Downloaded note: {fname}")
                except Exception as e:
                    logger.warning(f"Failed to download {s3_key}: {e}")

        # Write context text as file if provided
        context_text = t.get('context_text', '')
        if context_text:
            ctx_file = os.path.join(context_dir, f'transformation_{idx}_context.md')
            with open(ctx_file, 'w') as f:
                f.write(context_text)

        # Always build config.yaml — ATX transformations require additionalPlanContext
        build_info = svc._detect_build_system(repo_dir)
        target_version = task.get('target_version', '')
        svc._generate_config_yaml(context_dir, build_info, context_text=context_text, target_version=target_version)
        config_path = os.path.join(context_dir, 'config.yaml')

        # Ensure ApplicationSpecificContext is in .gitignore so ATX ignores it
        svc._ensure_gitignore_entry(repo_dir, 'ApplicationSpecificContext')

        # Run ATX
        atx_cmd_parts = ['atx', 'custom', 'def', 'exec']
        if config_path:
            atx_cmd_parts.extend(['-g', f'file://{config_path}'])
        atx_cmd_parts.extend(['-p', repo_dir, '-n', t_name, '-x', '-t'])
        logger.info(f"[{repo_name}] ATX command: {' '.join(atx_cmd_parts)}")

        atx_result = svc._run_atx(repo_dir, config_path, transformation_name=t_name)
        logger.info(f"[{repo_name}] ATX exit code: {atx_result.get('returncode', '?')}")

        # Remove ATX artifacts from git that ATX may have committed
        for exclude in ['ApplicationSpecificContext', 'ATXDocumentation', 'atx-run.log', 'build.log']:
            exclude_path = os.path.join(repo_dir, exclude)
            if os.path.exists(exclude_path):
                subprocess.run(
                    ['git', 'rm', '-r', '--cached', '--quiet', exclude],
                    capture_output=True, text=True, cwd=repo_dir
                )
        # Check if anything was unstaged
        staged_check = subprocess.run(
            ['git', 'diff', '--cached', '--name-only'],
            capture_output=True, text=True, cwd=repo_dir
        )
        if staged_check.stdout.strip():
            subprocess.run(
                ['git', 'commit', '--amend', '--no-edit'],
                capture_output=True, text=True, cwd=repo_dir
            )
            logger.info(f"[{repo_name}] Amended commit to remove ATX artifacts from git")

        # Upload results for this step
        result_prefix = f"{s3_prefix}/results/transformation_{idx}"
        uploaded = 0

        # Log repo directory contents for debugging
        try:
            top_items = os.listdir(repo_dir)
            logger.info(f"[{repo_name}] Repo dir contents: {top_items}")
        except Exception:
            pass

        # Upload ATXDocumentation if it exists
        docs_dir = os.path.join(repo_dir, 'ATXDocumentation')
        if os.path.exists(docs_dir):
            doc_files = []
            for root, _, files in os.walk(docs_dir):
                for fname in files:
                    local_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(local_path, docs_dir)
                    s3_key = f"{result_prefix}/ATXDocumentation/{rel_path}"
                    try:
                        s3.upload_file(local_path, bucket, s3_key)
                        uploaded += 1
                        doc_files.append(rel_path)
                    except Exception as e:
                        logger.error(f"Upload failed {s3_key}: {e}")
            logger.info(f"[{repo_name}] Uploaded {len(doc_files)} ATXDocumentation files")
        else:
            logger.warning(f"[{repo_name}] ATXDocumentation not found at {docs_dir}")

        # Upload atx-run.log and build.log
        for log_name in ['atx-run.log', 'build.log']:
            log_file = os.path.join(repo_dir, log_name)
            if os.path.exists(log_file):
                try:
                    s3.upload_file(log_file, bucket, f"{result_prefix}/{log_name}")
                    uploaded += 1
                except Exception as e:
                    logger.error(f"{log_name} upload failed: {e}")

        # Upload ApplicationSpecificContext directory
        if os.path.exists(context_dir):
            ctx_files = []
            for root, _, files in os.walk(context_dir):
                for fname in files:
                    local_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(local_path, context_dir)
                    s3_key = f"{result_prefix}/ApplicationSpecificContext/{rel_path}"
                    try:
                        s3.upload_file(local_path, bucket, s3_key)
                        uploaded += 1
                        ctx_files.append(rel_path)
                    except Exception as e:
                        logger.error(f"Upload failed {s3_key}: {e}")
            logger.info(f"[{repo_name}] Uploaded {len(ctx_files)} ApplicationSpecificContext files")

        # Upload ATX CLI artifacts (plan.json, validation_summary.md, worklog.log, etc.)
        conversation_id = atx_result.get('conversation_id')
        if conversation_id:
            atx_artifacts_dir = os.path.join(
                os.path.expanduser('~'), '.aws', 'atx', 'custom', conversation_id, 'artifacts'
            )
            if os.path.exists(atx_artifacts_dir):
                artifact_files = []
                for root, _, files in os.walk(atx_artifacts_dir):
                    for fname in files:
                        local_path = os.path.join(root, fname)
                        rel_path = os.path.relpath(local_path, atx_artifacts_dir)
                        s3_key = f"{result_prefix}/artifacts/{rel_path}"
                        try:
                            s3.upload_file(local_path, bucket, s3_key)
                            uploaded += 1
                            artifact_files.append(rel_path)
                        except Exception as e:
                            logger.error(f"Artifact upload failed {s3_key}: {e}")
                logger.info(f"[{repo_name}] Uploaded {len(artifact_files)} ATX artifacts: {artifact_files}")
            else:
                logger.warning(f"[{repo_name}] ATX artifacts dir not found: {atx_artifacts_dir}")
        else:
            logger.info(f"[{repo_name}] No conversation_id — skipping artifacts upload")

        # Upload git diff summary of changes made by this step
        try:
            diff_result = subprocess.run(['git', 'diff', '--stat', 'HEAD~1'], capture_output=True, text=True, cwd=repo_dir)
            if diff_result.returncode == 0 and diff_result.stdout.strip():
                diff_key = f"{result_prefix}/change-summary.txt"
                s3.put_object(Bucket=bucket, Key=diff_key, Body=diff_result.stdout.encode('utf-8'))
                uploaded += 1
        except Exception:
            pass

        logger.info(f"[{repo_name}] Uploaded {uploaded} files to {result_prefix}/")

        if not atx_result['success']:
            error = atx_result.get('error', 'ATX failed')
            update_step(idx, 'failed', error=error, result_s3_prefix=result_prefix)
            # Mark remaining steps as failed
            for j in range(idx + 1, len(transformations)):
                update_step(j, 'failed', error='Skipped — previous step failed')
            update_task_status('failed')
            logger.error(f"[{repo_name}] Transformation {idx} failed: {error}")
            return

        # ATX CLI commits changes itself during transformation.
        # Just capture the latest commit hash — no need to add/commit again.
        commit_hash = ''
        push_to_repo = task.get('push_to_repo', True)
        if push_to_repo:
            try:
                # Exclude ATX artifacts from commit — only commit source code changes
                subprocess.run(['git', 'add', '-A'], capture_output=True, text=True, cwd=repo_dir, check=True)
                # Unstage ATX-generated files that shouldn't be committed
                for exclude in ['ATXDocumentation', 'atx-run.log', 'ApplicationSpecificContext', 'build.log']:
                    subprocess.run(['git', 'reset', 'HEAD', '--', exclude], capture_output=True, text=True, cwd=repo_dir)

                # Log what's staged before committing
                diff_result = subprocess.run(['git', 'diff', '--cached', '--name-only'], capture_output=True, text=True, cwd=repo_dir)
                staged_files = diff_result.stdout.strip()
                if staged_files:
                    logger.info(f"[{repo_name}] Step {idx + 1} staged files:\n{staged_files}")
                else:
                    logger.warning(f"[{repo_name}] Step {idx + 1}: no source files changed — ATX only modified documentation/logs")

                commit_msg = f"ATX Transform Step {idx + 1}: {t_name} (run: {run_id})"
                commit_result = subprocess.run(['git', 'commit', '-m', commit_msg], capture_output=True, text=True, cwd=repo_dir)
                if commit_result.returncode == 0:
                    # Get commit hash
                    hash_result = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, cwd=repo_dir)
                    commit_hash = hash_result.stdout.strip()[:8] if hash_result.returncode == 0 else ''
                    logger.info(f"[{repo_name}] Step {idx + 1} committed: {commit_msg} ({commit_hash})")
                else:
                    logger.info(f"[{repo_name}] Step {idx + 1}: nothing to commit — {commit_result.stdout.strip()}")
            except Exception as e:
                logger.error(f"[{repo_name}] Step {idx + 1} commit error: {e}")

        update_step(idx, 'completed', result_s3_prefix=result_prefix, commit_hash=commit_hash,
                    commit_message=f"ATX Transform Step {idx + 1}: {t_name} (run: {run_id})")
        logger.info(f"[{repo_name}] Transformation {idx} completed")

    # Push ATX's commits to remote
    push_to_repo = task.get('push_to_repo', True)
    if push_to_repo:
        # ATX creates commits on a staging branch (atx-result-staging-<run_id>),
        # not on the target branch. We need to detect this, merge into the target
        # branch, then push.
        try:
            current_branch = subprocess.run(
                ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                capture_output=True, text=True, cwd=repo_dir
            ).stdout.strip()
            logger.info(f"[{repo_name}] Current branch after ATX: {current_branch}")

            if current_branch != branch and current_branch.startswith('atx-result-staging'):
                # ATX moved to a staging branch — merge its commits into target branch
                logger.info(f"[{repo_name}] ATX used staging branch '{current_branch}', merging into '{branch}'")
                staging_branch = current_branch

                # Checkout target branch
                checkout = subprocess.run(
                    ['git', 'checkout', branch],
                    capture_output=True, text=True, cwd=repo_dir
                )
                if checkout.returncode != 0:
                    logger.error(f"[{repo_name}] Failed to checkout {branch}: {checkout.stderr.strip()}")
                else:
                    # Merge staging branch into target
                    merge = subprocess.run(
                        ['git', 'merge', staging_branch, '--no-edit'],
                        capture_output=True, text=True, cwd=repo_dir
                    )
                    if merge.returncode != 0:
                        logger.error(f"[{repo_name}] Merge failed: {merge.stderr.strip()}")
                    else:
                        logger.info(f"[{repo_name}] Merged staging branch into {branch}")
            elif current_branch != branch:
                # ATX moved to some other branch — try to checkout target and merge
                logger.info(f"[{repo_name}] ATX on unexpected branch '{current_branch}', merging into '{branch}'")
                other_branch = current_branch
                subprocess.run(['git', 'checkout', branch], capture_output=True, text=True, cwd=repo_dir)
                subprocess.run(['git', 'merge', other_branch, '--no-edit'], capture_output=True, text=True, cwd=repo_dir)

            # Log commits ahead of origin
            ahead_result = subprocess.run(
                ['git', 'log', '--oneline', f'origin/{branch}..HEAD'],
                capture_output=True, text=True, cwd=repo_dir
            )
            commits_to_push = ahead_result.stdout.strip()
            if not commits_to_push:
                logger.warning(f"[{repo_name}] No commits to push after merge")
            else:
                logger.info(f"[{repo_name}] Pushing {len(commits_to_push.splitlines())} commit(s) to origin/{branch}:\n{commits_to_push}")

            # Push
            push_result = subprocess.run(
                ['git', 'push', 'origin', branch],
                capture_output=True, text=True, cwd=repo_dir, timeout=120
            )
            token_mask = Config.GITHUB_TOKEN or 'x'
            masked_stdout = push_result.stdout.replace(token_mask, '***') if push_result.stdout else ''
            masked_stderr = push_result.stderr.replace(token_mask, '***') if push_result.stderr else ''
            logger.info(f"[{repo_name}] Push returncode: {push_result.returncode}")
            if masked_stdout.strip():
                logger.info(f"[{repo_name}] Push stdout: {masked_stdout.strip()}")
            if masked_stderr.strip():
                logger.info(f"[{repo_name}] Push stderr: {masked_stderr.strip()}")
            if push_result.returncode == 0:
                logger.info(f"[{repo_name}] Push SUCCESS to origin/{branch}")
            else:
                logger.error(f"[{repo_name}] Push FAILED: {masked_stderr.strip()}")
        except Exception as e:
            logger.error(f"[{repo_name}] Git push exception: {e}")
    else:
        logger.info(f"[{repo_name}] Push skipped (push_to_repo=false)")

    # Run Tool 4: Extract transformation assessment from ATXDocumentation
    logger.info(f"[{repo_name}] Running Tool 4: Extract transformation assessment")
    try:
        from app.strands.tools.atx.extract_atx_transformation import extract_atx_transformation
        extract_result = extract_atx_transformation(task_id, app_id, run_id, transformations)
        logger.info(f"[{repo_name}] Tool 4: {extract_result.get('extracted', 0)}/{extract_result.get('total', 0)} steps extracted")
    except Exception as e:
        logger.error(f"[{repo_name}] Tool 4 failed: {e}")

    update_task_status('completed')
    logger.info(f"=== Transform Pipeline Completed: {len(transformations)} steps{', pushed to ' + branch if push_to_repo else ''} ===")


def main():
    task_id = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('ATX_TRANSFORM_TASK_ID', '')
    if not task_id:
        logger.error("Usage: python -m app.workers.atx_transform_worker <task_id>")
        sys.exit(1)
    run_transform_pipeline(task_id)


if __name__ == '__main__':
    main()
