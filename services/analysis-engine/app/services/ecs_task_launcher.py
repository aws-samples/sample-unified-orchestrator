"""ECS Fargate task launcher for ATX worker containers."""
import logging
import json
from typing import Dict, Any, List, Optional
from app.config import Config

logger = logging.getLogger(__name__)


class ECSTaskLauncher:
    """Launches ECS Fargate tasks for ATX code analysis per repo."""

    def __init__(self):
        self.ecs = Config.get_boto3_client('ecs')
        self.cluster = Config.ECS_CLUSTER
        self.task_definition = Config.ECS_ATX_TASK_DEFINITION
        self.subnets = [s.strip() for s in Config.ECS_SUBNETS.split(',') if s.strip()]
        self.security_groups = [s.strip() for s in Config.ECS_SECURITY_GROUPS.split(',') if s.strip()]

    def launch_task(self, task_id: str, app_id: str, repo_url: str,
                    run_id: str, selected_files: List[str]) -> Dict[str, Any]:
        """Launch a single ECS Fargate task for one repo."""
        if not self.cluster or not self.task_definition:
            logger.error("ECS_CLUSTER or ECS_ATX_TASK_DEFINITION not configured")
            return {'success': False, 'error': 'ECS not configured'}

        env_overrides = [
            {'name': 'ATX_TASK_ID', 'value': task_id},
            {'name': 'ATX_APP_ID', 'value': app_id},
            {'name': 'ATX_REPO_URL', 'value': repo_url},
            {'name': 'ATX_RUN_ID', 'value': run_id},
            {'name': 'ATX_SELECTED_FILES', 'value': json.dumps(selected_files)},
        ]

        try:
            response = self.ecs.run_task(
                cluster=self.cluster,
                taskDefinition=self.task_definition,
                launchType='FARGATE',
                count=1,
                networkConfiguration={
                    'awsvpcConfiguration': {
                        'subnets': self.subnets,
                        'securityGroups': self.security_groups,
                        'assignPublicIp': 'DISABLED'
                    }
                },
                overrides={
                    'containerOverrides': [{
                        'name': 'atx-worker',
                        'command': ['python', '-m', 'app.workers.atx_worker'],
                        'environment': env_overrides,
                    }]
                },
                tags=[
                    {'key': 'task_id', 'value': task_id},
                    {'key': 'app_id', 'value': app_id},
                    {'key': 'run_id', 'value': run_id},
                ]
            )

            tasks = response.get('tasks', [])
            if not tasks:
                failures = response.get('failures', [])
                error = failures[0].get('reason', 'Unknown') if failures else 'No task started'
                logger.error(f"ECS task launch failed: {error}")
                return {'success': False, 'error': error}

            ecs_task_arn = tasks[0]['taskArn']
            logger.info(f"Launched ECS task {ecs_task_arn} for {app_id}/{repo_url}")
            return {'success': True, 'ecs_task_arn': ecs_task_arn}

        except Exception as e:
            logger.error(f"ECS launch error: {e}", exc_info=True)
            return {'success': False, 'error': str(e)}

    def launch_tasks_for_app(self, task_id: str, app_id: str, repo_urls: List[str],
                              run_id: str, selected_files: List[str]) -> List[Dict[str, Any]]:
        """Launch one ECS task per repo for an application."""
        results = []
        for repo_url in repo_urls:
            result = self.launch_task(task_id, app_id, repo_url, run_id, selected_files)
            clean_url = repo_url.split('#')[0] if '#' in repo_url else repo_url
            repo_name = clean_url.rstrip('/').split('/')[-1].replace('.git', '')
            result['repo_url'] = repo_url
            result['repo_name'] = repo_name
            results.append(result)
        return results

    def launch_combined_task(self, task_id: str, app_id: str, repo_urls: List[str],
                              run_id: str, selected_files: List[str]) -> Dict[str, Any]:
        """Launch a single ECS Fargate task for combined multi-repo analysis."""
        if not self.cluster or not self.task_definition:
            logger.error("ECS_CLUSTER or ECS_ATX_TASK_DEFINITION not configured")
            return {'success': False, 'error': 'ECS not configured'}

        env_overrides = [
            {'name': 'ATX_TASK_ID', 'value': task_id},
            {'name': 'ATX_APP_ID', 'value': app_id},
            {'name': 'ATX_REPO_URLS', 'value': json.dumps(repo_urls)},
            {'name': 'ATX_RUN_ID', 'value': run_id},
            {'name': 'ATX_SELECTED_FILES', 'value': json.dumps(selected_files)},
            {'name': 'ATX_MODE', 'value': 'combined'},
        ]

        try:
            response = self.ecs.run_task(
                cluster=self.cluster,
                taskDefinition=self.task_definition,
                launchType='FARGATE',
                count=1,
                networkConfiguration={
                    'awsvpcConfiguration': {
                        'subnets': self.subnets,
                        'securityGroups': self.security_groups,
                        'assignPublicIp': 'DISABLED'
                    }
                },
                overrides={
                    'containerOverrides': [{
                        'name': 'atx-worker',
                        'command': ['python', '-m', 'app.workers.atx_worker', '--combined'],
                        'environment': env_overrides,
                    }]
                },
                tags=[
                    {'key': 'task_id', 'value': task_id},
                    {'key': 'app_id', 'value': app_id},
                    {'key': 'run_id', 'value': run_id},
                    {'key': 'mode', 'value': 'combined'},
                ]
            )

            tasks = response.get('tasks', [])
            if not tasks:
                failures = response.get('failures', [])
                error = failures[0].get('reason', 'Unknown') if failures else 'No task started'
                logger.error(f"ECS combined task launch failed: {error}")
                return {'success': False, 'error': error}

            ecs_task_arn = tasks[0]['taskArn']
            logger.info(f"Launched ECS combined task {ecs_task_arn} for {app_id} ({len(repo_urls)} repos)")
            return {'success': True, 'ecs_task_arn': ecs_task_arn}

        except Exception as e:
            logger.error(f"ECS combined launch error: {e}", exc_info=True)
            return {'success': False, 'error': str(e)}
