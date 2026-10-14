"""Risk assessment service with StrandAgent integration."""
from typing import List, Optional, Dict, Any
import uuid
import random
from datetime import datetime
from decimal import Decimal
import json
import re
import logging
import os

logger = logging.getLogger(__name__)

# Import performance configuration
try:
    from app.config import Config
    PERFORMANCE_CONFIG_AVAILABLE = True
except ImportError:
    PERFORMANCE_CONFIG_AVAILABLE = False
    logger.warning("Performance configuration not available")

# Import StrandAgent
try:
    from app.strands.strand_agent import StrandAgent
    STRAND_AGENT_AVAILABLE = True
except ImportError:
    STRAND_AGENT_AVAILABLE = False
    logger.warning("StrandAgent not available")

# Import risk assessment tools (fallback if StrandAgent not available)
try:
    from app.strands.tools.risks.assess_team_readiness import assess_team_readiness
    from app.strands.tools.risks.assess_business_readiness import assess_business_readiness
    TOOLS_AVAILABLE = True
except ImportError:
    TOOLS_AVAILABLE = False

# Import repository
try:
    from app.repositories.risk_assessment_repository import RiskAssessmentRepository
    from app.models.risk_assessment import RiskAssessment
    REPOSITORY_AVAILABLE = True
except ImportError:
    REPOSITORY_AVAILABLE = False


def _extract_tool_result(agent_response):
    """
    Extract tool result from StrandAgent response.

    Handles different response formats and extracts the actual tool result.
    The Strands SDK AgentResult.message is a dict with {'role': str, 'content': list}.
    """
    if not agent_response:
        logger.error("Agent response is None")
        return None

    logger.info(f"Extracting tool result from response type: {type(agent_response).__name__}")

    # Method 1: Check for message attribute (Strands SDK AgentResult pattern)
    if hasattr(agent_response, 'message'):
        logger.info("Found message attribute in AgentResult")
        message = agent_response.message

        # Message is a dict with 'role' and 'content' keys
        if isinstance(message, dict) and 'content' in message:
            content = message['content']
            logger.info(f"Found content in message dict, type: {type(content)}")

            # Content is a list of content blocks
            if isinstance(content, list):
                logger.info(f"Content is a list with {len(content)} items")
                for i, item in enumerate(content):
                    logger.info(f"Content item {i}: type={type(item)}")

                    if isinstance(item, dict):
                        logger.info(f"Content item {i} keys: {list(item.keys())}")

                        # Check if this is a tool_use block with result
                        if item.get('type') == 'tool_result':
                            logger.info("Found tool_result block")
                            result_content = item.get('content')
                            if isinstance(result_content, str):
                                try:
                                    return json.loads(result_content)
                                except:
                                    return result_content
                            else:
                                return result_content

                        # Check if item has the actual result data (component analysis fields)
                        if 'target_version_coverage' in item or 'component_analysis' in item:
                            logger.info("Found component analysis data in content block")
                            return item

                        # Check for text block that might contain JSON
                        if item.get('type') == 'text':
                            text_content = item.get('text', '')
                            logger.info(f"Found text block with {len(text_content)} chars")
                            # Try to parse as JSON
                            try:
                                return json.loads(text_content)
                            except:
                                pass

            # Content might be a string with JSON
            elif isinstance(content, str):
                logger.info("Content is a string - trying to parse as JSON")
                try:
                    return json.loads(content)
                except:
                    logger.warning("Content is not valid JSON")

    # Method 2: Check for tool_results attribute (direct)
    if hasattr(agent_response, 'tool_results') and agent_response.tool_results:
        logger.info(f"Found {len(agent_response.tool_results)} tool results")
        tool_result = agent_response.tool_results[0]

        if isinstance(tool_result, dict):
            return tool_result
        elif hasattr(tool_result, 'content'):
            try:
                return json.loads(tool_result.content)
            except:
                return tool_result.content
        else:
            return tool_result

    # Method 3: Check for steps attribute
    if hasattr(agent_response, 'steps') and agent_response.steps:
        logger.info(f"Found {len(agent_response.steps)} steps in response")
        for step in agent_response.steps:
            if hasattr(step, 'tool_result'):
                tool_result = step.tool_result
                if isinstance(tool_result, dict):
                    return tool_result
                elif hasattr(tool_result, 'content'):
                    try:
                        return json.loads(tool_result.content)
                    except:
                        return tool_result.content
                else:
                    return tool_result

    # Method 4: Check state attribute
    if hasattr(agent_response, 'state') and agent_response.state:
        if isinstance(agent_response.state, dict) and agent_response.state:
            logger.info(f"State dict keys: {list(agent_response.state.keys())}")
            if 'tool_results' in agent_response.state:
                tool_results = agent_response.state['tool_results']
                if tool_results:
                    return tool_results[0] if isinstance(tool_results, list) else tool_results

    # Method 5: Check if response itself is the result
    if isinstance(agent_response, dict):
        logger.info("Response itself is a dict - returning directly")
        return agent_response

    logger.warning("Could not find tool result in response")
    return None


class RiskService:
    """Service for risk assessment operations using StrandAgent."""

    def __init__(self):
        """Initialize risk service."""
        # Repository will be initialized lazily when needed
        self._repository = None
        # Lazy S3 client initialization
        self.__s3_client = None
        # Initialize StrandAgent
        self._strand_agent = None
        if STRAND_AGENT_AVAILABLE:
            try:
                print("INFO: Initializing StrandAgent...")
                self._strand_agent = StrandAgent()
                print(f"INFO: StrandAgent initialized successfully with tools: {self._strand_agent.tool_names}")
            except Exception as e:
                print(f"ERROR: Could not initialize StrandAgent: {e}")
                import traceback
                traceback.print_exc()
        else:
            print("WARNING: StrandAgent not available - STRAND_AGENT_AVAILABLE is False")

        # Initialize application status service for lifecycle tracking
        from app.services.application_status_service import ApplicationStatusService
        self.status_service = ApplicationStatusService()

    @property
    def strand_agent(self):
        """Get StrandAgent instance."""
        return self._strand_agent

    @property
    def repository(self):
        """Lazy-load repository when needed."""
        if self._repository is None and REPOSITORY_AVAILABLE:
            try:
                self._repository = RiskAssessmentRepository()
            except Exception as e:
                print(f"Warning: Could not initialize RiskAssessmentRepository: {e}")
                self._repository = False  # Mark as failed to avoid retrying
        return self._repository if self._repository is not False else None

    @property
    def _s3_client(self):
        """Lazy-load S3 client when needed."""
        if self.__s3_client is None:
            from app.config import Config
            self.__s3_client = Config.get_boto3_client('s3')
        return self.__s3_client

    def assess_risk(self, entity_id: str, entity_type: str = 'application',
                   team_readiness_inputs: dict = None, business_readiness_inputs: dict = None) -> Dict[str, Any]:
        """Start risk assessment for application, pod, or wave."""
        # Validate entity type
        valid_types = ['application', 'pod', 'wave']
        if entity_type not in valid_types:
            raise ValueError(f"Invalid entity_type. Must be one of: {valid_types}")

        # Readiness inputs should only be provided for application-level assessments
        if (team_readiness_inputs or business_readiness_inputs) and entity_type != 'application':
            raise ValueError("team_readiness_inputs and business_readiness_inputs are only valid for application-level assessments")

        # Set risk assessment status to IN_PROGRESS for application-level assessments
        if entity_type == 'application':
            try:
                from app.models.application import ApplicationStatus
                self.status_service.update_risk_assessment_status(
                    entity_id,
                    ApplicationStatus.RISK_IN_PROGRESS
                )
                logger.info(f"Set risk_assessment_status to IN_PROGRESS for {entity_id}")
            except Exception as e:
                logger.warning(f"Could not update risk assessment status: {e}")

        # Generate assessment ID
        assessment_id = str(uuid.uuid4())
        assessment_date = int(datetime.now().timestamp())

        # Create initial record in DynamoDB with "in_progress" status
        if self.repository and entity_type == 'application':
            try:
                initial_assessment = RiskAssessment(
                    assessment_id=assessment_id,
                    app_id=entity_id,
                    overall_score=Decimal('0'),
                    risk_level='pending',
                    assessment_date=assessment_date,
                    s3_report_key='pending',  # Will be updated when complete
                    wave_id=None
                )
                self.repository.create_assessment(initial_assessment)
                print(f"Created initial assessment record in DynamoDB: {assessment_id}")
            except Exception as e:
                print(f"Warning: Could not create initial assessment in DynamoDB: {e}")

        try:
            # Process assessment synchronously (in production, this would be async via Celery/SQS)
            self._process_assessment_sync(assessment_id, entity_id, entity_type,
                                         team_readiness_inputs, business_readiness_inputs)

            # Keep risk assessment status as IN_PROGRESS (not COMPLETED)
            # It will be marked COMPLETED when Wave Analysis completes
            logger.info(f"Risk assessment completed for {entity_id}, status remains IN_PROGRESS")

            return {
                'assessment_id': assessment_id,
                'status': 'completed',
                'entity_type': entity_type,
                'entity_id': entity_id,
                'message': f'Assessment completed for {entity_type}: {entity_id}'
            }
        except Exception as e:
            # Reset status to NOT_STARTED on failure
            if entity_type == 'application':
                try:
                    from app.models.application import ApplicationStatus
                    self.status_service.update_risk_assessment_status(
                        entity_id,
                        ApplicationStatus.RISK_NOT_STARTED
                    )
                    logger.error(f"Reset risk_assessment_status to NOT_STARTED for {entity_id} due to error")
                except Exception as status_error:
                    logger.warning(f"Could not reset risk assessment status: {status_error}")
            raise

    def assess_risk_parallel(self, app_ids: List[str],
                            team_readiness_inputs: dict = None,
                            business_readiness_inputs: dict = None,
                            max_workers: int = 5) -> Dict[str, Any]:
        """
        Assess multiple applications in parallel.

        Args:
            app_ids: List of application IDs to assess
            team_readiness_inputs: Optional team readiness inputs (applied to all apps)
            business_readiness_inputs: Optional business readiness inputs (applied to all apps)
            max_workers: Maximum number of parallel workers (default: 5)

        Returns:
            Dictionary with results
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import time as _time
        import gc
        from app.models.application import ApplicationStatus

        # Set all applications to IN_PROGRESS
        for app_id in app_ids:
            try:
                self.status_service.update_risk_assessment_status(
                    app_id,
                    ApplicationStatus.RISK_IN_PROGRESS
                )
                logger.info(f"Set risk_assessment_status to IN_PROGRESS for {app_id}")
            except Exception as e:
                logger.warning(f"Could not update risk assessment status for {app_id}: {e}")

        # DynamoDB repos work directly in threads - no app context needed
        results = []

        # Process assessments in parallel with staggered start to avoid
        # clone-directory collisions and GitHub rate-limit bursts
        def assess_single_app(app_id, index):
            try:
                # Stagger start: 0.5s jitter per worker
                _time.sleep(index * 0.5)
                result = self._execute_assessment(app_id, team_readiness_inputs, business_readiness_inputs)

                # Keep status as IN_PROGRESS (will be marked COMPLETED when Wave Analysis completes)
                logger.info(f"Risk assessment completed for {app_id}, status remains IN_PROGRESS")
                gc.collect()
                return result
            except Exception as e:
                logger.error(f"Error assessing app {app_id}: {e}")
                # Reset status to NOT_STARTED on failure
                try:
                    self.status_service.update_risk_assessment_status(
                        app_id,
                        ApplicationStatus.RISK_NOT_STARTED
                    )
                    logger.error(f"Reset risk_assessment_status to NOT_STARTED for {app_id} due to error")
                except Exception as status_error:
                    logger.warning(f"Could not reset status for {app_id}: {status_error}")
                return {
                    'app_id': app_id,
                    'error': str(e),
                    'status': 'failed'
                }

        # Execute in parallel
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_app = {executor.submit(assess_single_app, app_id, i): app_id for i, app_id in enumerate(app_ids)}

            for future in as_completed(future_to_app):
                app_id = future_to_app[future]
                try:
                    result = future.result()
                    results.append(result)
                    logger.info(f"Completed assessment for {app_id}")
                except Exception as e:
                    logger.error(f"Error processing result for {app_id}: {e}")
                    # Reset status on error
                    try:
                        self.status_service.update_risk_assessment_status(
                            app_id,
                            ApplicationStatus.RISK_NOT_STARTED
                        )
                    except Exception as status_error:
                        logger.warning(f"Could not reset status for {app_id}: {status_error}")
                    results.append({
                        'app_id': app_id,
                        'error': str(e),
                        'status': 'failed'
                    })

        return {
            'status': 'completed',
            'entity_type': 'parallel',
            'total_apps': len(app_ids),
            'completed_apps': len(results),
            'results': results,
            'message': f'Parallel assessment completed for {len(app_ids)} applications'
        }

    def _process_assessment_sync(self, assessment_id: str, entity_id: str, entity_type: str,
                                team_readiness_inputs: dict = None, business_readiness_inputs: dict = None):
        """Process assessment synchronously."""
        # Generate assessment based on entity type
        if entity_type == 'application':
            # Single application assessment - pass the assessment_id
            self._execute_assessment(entity_id, team_readiness_inputs, business_readiness_inputs, assessment_id)
        elif entity_type == 'pod':
            # Pod assessment - assess multiple applications in the pod
            num_apps = random.randint(3, 5)
            for i in range(num_apps):
                app_id = f"{entity_id}-app-{i+1}"
                self._execute_assessment(app_id, None, None)
        else:  # wave
            # Wave assessment - assess multiple applications in the wave
            num_apps = random.randint(10, 20)
            for i in range(num_apps):
                app_id = f"{entity_id}-app-{i+1}"
                self._execute_assessment(app_id, None, None)

    def get_all_assessments(self) -> List[Dict[str, Any]]:
        """Get all risk assessments from DynamoDB."""
        if not self.repository:
            return []

        try:
            assessments = self.repository.get_all_assessments()
            # Convert to dict format
            return [self._assessment_to_dict(assessment) for assessment in assessments]
        except Exception as e:
            print(f"Error getting all assessments: {e}")
            return []

    def get_assessments_by_app(self, app_id: str) -> List[Dict[str, Any]]:
        """Get all assessments for a specific application."""
        if not self.repository:
            return []

        try:
            assessments = self.repository.get_assessments_by_app(app_id)
            # Convert to dict format
            return [self._assessment_to_dict(assessment) for assessment in assessments]
        except Exception as e:
            print(f"Error getting assessments for app {app_id}: {e}")
            return []

    def _assessment_to_dict(self, assessment) -> Dict[str, Any]:
        """Convert RiskAssessment model to dictionary."""
        try:
            return {
                'assessment_id': assessment.assessment_id,
                'app_id': assessment.app_id,
                'overall_score': float(assessment.overall_score),
                'risk_level': assessment.risk_level,
                'assessment_date': assessment.assessment_date,
                's3_report_key': assessment.s3_report_key,
                's3_bucket': assessment.s3_bucket,
                'wave_id': assessment.wave_id
            }
        except AttributeError as e:
            # Handle old format assessments
            print(f"Warning: Old format assessment detected: {e}")
            return None

    def get_assessment(self, assessment_id: str) -> Optional[Dict[str, Any]]:
        """Get assessment metadata from DynamoDB."""
        if not self.repository:
            return None

        try:
            # Direct partition key query — no table scan
            db_assessment = self.repository.get_assessment_by_id(assessment_id)
            if db_assessment:
                result = self._assessment_to_dict(db_assessment)
                if result:
                    result['status'] = 'completed'
                    return result
        except Exception as e:
            print(f"Warning: Could not retrieve assessment from DynamoDB: {e}")
            import traceback
            traceback.print_exc()

        return None

    def get_full_report_from_s3(self, s3_key: str) -> Optional[Dict[str, Any]]:
        """Load full detailed report from S3."""
        try:
            from app.config import Config
            s3_client = self._s3_client
            bucket_name = Config.S3_ARA_BUCKET

            if not bucket_name:
                raise ValueError("S3_ARA_BUCKET is not configured")

            logger.info(f"Fetching full report from S3: {s3_key}")
            response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            report = json.loads(response['Body'].read().decode('utf-8'))
            logger.info(f"Successfully loaded full report from S3")
            return report
        except Exception as e:
            logger.error(f"Error fetching report from S3: {e}")
            import traceback
            traceback.print_exc()
            return None

    def save_html_report_to_s3(self, s3_key: str, html_content: str) -> bool:
        """Save HTML report to S3."""
        try:
            from app.config import Config
            s3_client = self._s3_client
            bucket_name = Config.S3_ARA_BUCKET

            if not bucket_name:
                raise ValueError("S3_ARA_BUCKET is not configured")

            logger.info(f"Saving HTML report to S3: {s3_key}")
            s3_client.put_object(
                Bucket=bucket_name,
                Key=s3_key,
                Body=html_content.encode('utf-8'),
                ContentType='text/html'
            )
            logger.info(f"Successfully saved HTML report to S3")
            return True
        except Exception as e:
            logger.error(f"Error saving HTML report to S3: {e}")
            import traceback
            traceback.print_exc()
            return False

    def get_risk_summary(self) -> Dict[str, Any]:
        """Get risk summary across all applications."""
        # Mock summary data
        return {
            'total_applications': 150,
            'assessed_applications': 120,
            'risk_distribution': {
                'critical': 15,
                'high': 35,
                'medium': 50,
                'low': 20
            },
            'wave_distribution': {
                'wave_1': 20,
                'wave_2_3': 45,
                'wave_4_5': 35,
                'wave_6_plus': 15,
                'deferred': 5
            },
            'average_scores': {
                'overall_readiness': 68.5,
                'risk_score': 62.3,
                'complexity_score': 71.2,
                'migration_readiness': 65.8,
                'team_readiness': 78.4,
                'business_readiness': 82.1
            }
        }

    def get_complexity_score(self, app_id: str) -> Dict[str, Any]:
        """Get complexity score for application using StrandAgent (mock implementation)."""
        # Generate consistent mock data based on app_id
        random.seed(hash(app_id))

        integration_count = random.randint(5, 50)
        version_gap = random.randint(1, 10)

        return {
            'app_id': app_id,
            'complexity_score': random.randint(40, 95),
            'breakdown': {
                'integration_count': {
                    'value': integration_count,
                    'score': max(0, 100 - (integration_count * 2)),
                    'weight': 30
                },
                'version_gap': {
                    'value': version_gap,
                    'score': max(0, 100 - (version_gap * 10)),
                    'weight': 25
                },
                'application_type': {
                    'value': random.choice(['Monolith', 'Microservice', 'Hybrid']),
                    'score': random.randint(50, 90),
                    'weight': 20
                },
                'testing_maturity': {
                    'value': f"{random.randint(20, 85)}%",
                    'score': random.randint(40, 85),
                    'weight': 15
                },
                'data_migration_size': {
                    'value': f"{random.randint(10, 500)}GB",
                    'score': random.randint(50, 90),
                    'weight': 10
                }
            }
        }

    def get_readiness_score(self, app_id: str) -> Dict[str, Any]:
        """Get readiness score for application using StrandAgent (mock implementation)."""
        # Generate consistent mock data based on app_id
        random.seed(hash(app_id))

        return {
            'app_id': app_id,
            'migration_readiness': {
                'score': random.randint(45, 90),
                'breakdown': {
                    'source_code_availability': {
                        'value': random.choice(['Available', 'Partial', 'Missing']),
                        'score': random.randint(60, 100),
                        'weight': 25
                    },
                    'ci_cd_maturity': {
                        'value': random.choice(['Advanced', 'Intermediate', 'Basic', 'None']),
                        'score': random.randint(40, 95),
                        'weight': 20
                    },
                    'target_version_availability': {
                        'value': f"{random.randint(60, 100)}%",
                        'score': random.randint(60, 100),
                        'weight': 20
                    },
                    'documentation_quality': {
                        'value': random.choice(['Excellent', 'Good', 'Fair', 'Poor']),
                        'score': random.randint(40, 90),
                        'weight': 15
                    },
                    'monitoring_maturity': {
                        'value': random.choice(['Advanced', 'Basic', 'None']),
                        'score': random.randint(50, 90),
                        'weight': 10
                    },
                    'code_coverage': {
                        'value': f"{random.randint(20, 85)}%",
                        'score': random.randint(30, 85),
                        'weight': 10
                    }
                }
            },
            'team_readiness': {
                'score': random.randint(60, 95),
                'breakdown': {
                    'team_availability': {
                        'value': f"{random.randint(50, 100)}%",
                        'score': random.randint(50, 100),
                        'weight': 30
                    },
                    'skill_level': {
                        'value': random.choice(['Expert', 'Advanced', 'Intermediate', 'Beginner']),
                        'score': random.randint(50, 95),
                        'weight': 30
                    },
                    'knowledge_transfer': {
                        'value': random.choice(['Complete', 'In Progress', 'Not Started']),
                        'score': random.randint(40, 100),
                        'weight': 25
                    },
                    'training_completion': {
                        'value': f"{random.randint(40, 100)}%",
                        'score': random.randint(40, 100),
                        'weight': 15
                    }
                }
            },
            'business_readiness': {
                'score': random.randint(70, 98),
                'breakdown': {
                    'maintenance_window': {
                        'value': random.choice(['Available', 'Limited', 'None']),
                        'score': random.randint(60, 100),
                        'weight': 25
                    },
                    'business_calendar': {
                        'value': random.choice(['Aligned', 'Partially Aligned', 'Conflicts']),
                        'score': random.randint(60, 100),
                        'weight': 25
                    },
                    'stakeholder_alignment': {
                        'value': random.choice(['Strong', 'Moderate', 'Weak']),
                        'score': random.randint(60, 95),
                        'weight': 25
                    },
                    'budget_availability': {
                        'value': random.choice(['Approved', 'Pending', 'Not Allocated']),
                        'score': random.randint(70, 100),
                        'weight': 25
                    }
                }
            }
        }

    def get_actionable_items(self, app_id: str, comprehensive_report: Dict[str, Any] = None,
                             component_analysis: Dict[str, Any] = None,
                             scm_analysis: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """Derive actionable items from real assessment data.

        Items are generated based on component analysis, SCM analysis,
        and complexity metrics — no mocks, no Bedrock calls.
        """
        items: List[Dict[str, Any]] = []
        comp = component_analysis or {}
        scm = scm_analysis or {}
        report = comprehensive_report or {}
        categories = report.get('categories', {})
        complexity = report.get('complexity_metrics', {})
        metrics = complexity.get('metrics', {}) if isinstance(complexity, dict) else {}

        # 1. Target version gap
        total = comp.get('total_components', 0)
        unmatched = comp.get('unmatched_components', 0)
        if unmatched > 0 and total > 0:
            pct = round(unmatched / total * 100)
            severity = 'critical' if pct > 80 else 'high' if pct > 50 else 'medium'
            items.append({
                'id': f'{app_id}-target-gap',
                'type': 'target_gap',
                'severity': severity,
                'title': 'No Target Versions Available',
                'description': f'{unmatched} of {total} components ({pct}%) have no approved target version.',
                'recommendation': 'Upload approved target component list to enable version matching.',
            })

        # 2. EOSL components
        eosl_count = comp.get('eosl_components', 0)
        if eosl_count > 0:
            severity = 'critical' if eosl_count > 50 else 'high' if eosl_count > 10 else 'medium'
            items.append({
                'id': f'{app_id}-eosl',
                'type': 'eosl',
                'severity': severity,
                'title': 'EOSL Components Detected',
                'description': f'{eosl_count} component{"s have" if eosl_count != 1 else " has"} reached end of support life.',
                'recommendation': 'Identify approved target versions for all EOSL components before migration.',
            })

        # 4. Source code not available
        source_score = scm.get('source_code_score', None)
        source_repos = scm.get('source_code_repos', [])
        if source_score == 0 or (source_score is not None and len(source_repos) == 0):
            items.append({
                'id': f'{app_id}-scm-missing',
                'type': 'scm_missing',
                'severity': 'high',
                'title': 'Source Code Not Available',
                'description': 'No SCM repository URLs configured. Code analysis could not be performed.',
                'recommendation': 'Configure SCM repository URLs to enable full code analysis.',
            })

        # 5. High integration count (flag when 16+ systems — score 60+)
        integration_count = metrics.get('integration_count', 0)
        integration_score = metrics.get('integration_score', 0)
        if integration_count > 15:
            severity = 'high' if integration_count > 30 else 'medium'
            items.append({
                'id': f'{app_id}-integrations',
                'type': 'integration',
                'severity': severity,
                'title': 'High Integration Count',
                'description': f'{integration_count} upstream/downstream systems detected (score {integration_score}/100). Each integration point is a potential failure point requiring coordination.',
                'recommendation': 'Review integration dependencies and plan migration sequencing accordingly.',
            })

        # 6. Complex application type (flag when score >= 60 — socket-based, legacy, mainframe)
        app_type_score = metrics.get('application_type_score', 0)
        app_type = metrics.get('application_type', 'Unknown')
        if app_type_score >= 60:
            severity = 'high' if app_type_score >= 80 else 'medium'
            items.append({
                'id': f'{app_id}-app-type',
                'type': 'app_type',
                'severity': severity,
                'title': 'Complex Application Architecture',
                'description': f'Application type "{app_type}" scores {app_type_score}/100. Socket-based, legacy, and mainframe integrations are significantly harder to migrate.',
                'recommendation': 'Plan additional migration effort and testing for this architecture type.',
            })

        # 6. Low testing maturity (flag when score >= 75 — unit only or no tests)
        testing_score = metrics.get('testing_maturity_score', 0)
        testing_maturity = metrics.get('testing_maturity', 'Unknown')
        if testing_score >= 75:
            severity = 'high' if testing_score == 100 else 'medium'
            desc = 'No automated tests detected.' if testing_score == 100 else 'Only unit tests detected — no integration or e2e tests.'
            items.append({
                'id': f'{app_id}-testing',
                'type': 'testing',
                'severity': severity,
                'title': 'Low Testing Maturity',
                'description': desc,
                'recommendation': 'Migration carries higher risk without automated test coverage to validate changes.',
            })

        return items

    def get_assessment_components(self, assessment_id: str) -> Optional[List[Dict[str, Any]]]:
        """
        Get full component list for an assessment from S3.

        Args:
            assessment_id: Assessment ID to fetch components for

        Returns:
            List of component dictionaries or None if not found
        """
        try:
            # First, get the assessment to find the S3 key
            assessment = self.get_assessment(assessment_id)

            if not assessment:
                logger.error(f"Assessment {assessment_id} not found")
                return None

            # Extract S3 key from readiness details
            readiness = assessment.get('readiness', {})
            migration_readiness = readiness.get('migration_readiness', {})
            component_analysis = migration_readiness.get('component_analysis', {})
            s3_key = component_analysis.get('s3_key')

            if not s3_key:
                logger.warning(f"No S3 key found for assessment {assessment_id}")
                return []

            # Fetch from S3
            from app.config import Config
            s3_client = self._s3_client
            bucket_name = Config.S3_ARA_BUCKET

            if not bucket_name:
                raise ValueError("S3_ARA_BUCKET is not configured")

            response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            components_json = response['Body'].read().decode('utf-8')
            components = json.loads(components_json)

            logger.info(f"Retrieved {len(components)} components from S3 for assessment {assessment_id}")
            return components

        except s3_client.exceptions.NoSuchKey:
            logger.error(f"S3 key not found: {s3_key}")
            return None
        except Exception as e:
            logger.error(f"Error fetching components from S3: {e}")
            return None

    def _calculate_team_readiness_score(self, team_readiness_inputs: dict = None) -> int:
        """Calculate team readiness score from inputs.

        Weights from migration-application-score.md:
        - Team Availability: 30%
        - Skill Level: 30%
        - Knowledge Transfer: 25%
        - Training Completed: 15%
        """
        if not team_readiness_inputs:
            # Default to 100 for pod/wave assessments
            return 100

        # Use the actual risk assessment tool if available
        if TOOLS_AVAILABLE:
            try:
                # Get values from inputs with defaults
                team_availability = team_readiness_inputs.get('team_availability', 'None')
                skill_level = team_readiness_inputs.get('skill_level', 'No experience')
                knowledge_transfer = team_readiness_inputs.get('knowledge_transfer', 'None')
                training_completed = team_readiness_inputs.get('training_completed', 'No training')

                # Call the assess_team_readiness tool
                result = assess_team_readiness(
                    team_availability=team_availability,
                    skill_level=skill_level,
                    knowledge_transfer=knowledge_transfer,
                    training_completed=training_completed
                )

                return int(result['team_readiness_score'])
            except Exception as e:
                # Fall back to manual calculation if tool fails
                print(f"Warning: assess_team_readiness tool failed: {e}. Using fallback calculation.")

        # Fallback: Manual calculation (same logic as the tool)
        # Score mappings from migration-application-score.md
        team_availability_scores = {
            'Dedicated': 100,
            'Part-time': 50,
            'None': 0
        }

        skill_level_scores = {
            'Expert': 100,
            'Some experience': 50,
            'No experience': 0
        }

        knowledge_transfer_scores = {
            'Full docs + devs': 100,
            'Key person': 75,
            'Docs only': 50,
            'None': 0
        }

        training_completed_scores = {
            'All trained': 100,
            'Some trained': 50,
            'No training': 0
        }

        # Get scores for each factor (default to 0 if not provided)
        team_availability = team_availability_scores.get(team_readiness_inputs.get('team_availability'), 0)
        skill_level = skill_level_scores.get(team_readiness_inputs.get('skill_level'), 0)
        knowledge_transfer = knowledge_transfer_scores.get(team_readiness_inputs.get('knowledge_transfer'), 0)
        training_completed = training_completed_scores.get(team_readiness_inputs.get('training_completed'), 0)

        # Calculate weighted score
        score = (
            team_availability * 0.30 +
            skill_level * 0.30 +
            knowledge_transfer * 0.25 +
            training_completed * 0.15
        )

        return int(score)

    def _calculate_business_readiness_score(self, business_readiness_inputs: dict = None) -> int:
        """Calculate business readiness score from inputs.

        Weights from migration-application-score.md:
        - Maintenance Window: 25%
        - Business Calendar: 25%
        - Stakeholder Alignment: 25%
        - Budget Availability: 25%
        """
        if not business_readiness_inputs:
            # Default to 100 for pod/wave assessments
            return 100

        # Use the actual risk assessment tool if available
        if TOOLS_AVAILABLE:
            try:
                # Get values from inputs with defaults
                maintenance_window = business_readiness_inputs.get('maintenance_window', 'No downtime')
                business_calendar = business_readiness_inputs.get('business_calendar', 'Peak season')
                stakeholder_alignment = business_readiness_inputs.get('stakeholder_alignment', 'Strong resistance')
                budget_availability = business_readiness_inputs.get('budget_availability', 'No budget')

                # Call the assess_business_readiness tool
                result = assess_business_readiness(
                    maintenance_window=maintenance_window,
                    business_calendar=business_calendar,
                    stakeholder_alignment=stakeholder_alignment,
                    budget_availability=budget_availability
                )

                return int(result['business_readiness_score'])
            except Exception as e:
                # Fall back to manual calculation if tool fails
                print(f"Warning: assess_business_readiness tool failed: {e}. Using fallback calculation.")

        # Fallback: Manual calculation (same logic as the tool)
        # Score mappings from migration-application-score.md
        maintenance_window_scores = {
            'Flexible': 100,
            'Limited': 50,
            'No downtime': 0
        }

        business_calendar_scores = {
            'Off-peak': 100,
            'Normal': 50,
            'Peak season': 0
        }

        stakeholder_alignment_scores = {
            'Full buy-in': 100,
            'Some concerns': 50,
            'Strong resistance': 0
        }

        budget_availability_scores = {
            'Fully funded': 100,
            'Partial': 50,
            'No budget': 0
        }

        # Get scores for each factor (default to 0 if not provided)
        maintenance_window = maintenance_window_scores.get(business_readiness_inputs.get('maintenance_window'), 0)
        business_calendar = business_calendar_scores.get(business_readiness_inputs.get('business_calendar'), 0)
        stakeholder_alignment = stakeholder_alignment_scores.get(business_readiness_inputs.get('stakeholder_alignment'), 0)
        budget_availability = budget_availability_scores.get(business_readiness_inputs.get('budget_availability'), 0)

        # Calculate weighted score (all equal weights)
        score = (
            maintenance_window * 0.25 +
            business_calendar * 0.25 +
            stakeholder_alignment * 0.25 +
            budget_availability * 0.25
        )

        return int(score)

    def _execute_assessment(self, app_id: str, team_readiness_inputs: dict = None,
                                  business_readiness_inputs: dict = None, assessment_id: str = None) -> Dict[str, Any]:
        """Execute full assessment for an application using RiskOrchestrator."""
        # Generate consistent mock data based on app_id
        random.seed(hash(app_id))

        # Use provided assessment_id or generate new one
        if not assessment_id:
            assessment_id = str(uuid.uuid4())

        assessment_date = int(datetime.now().timestamp())

        # Use RiskOrchestrator to run the full assessment workflow
        try:
            # Use risk orchestrator for assessment
            from app.orchestrators.risk_orchestrator import RiskOrchestrator
            print(f"Starting risk assessment for app {app_id}...")

            # Configure orchestrator with performance settings if available
            if PERFORMANCE_CONFIG_AVAILABLE:
                orchestrator = RiskOrchestrator(
                    use_cache=False,  # Redis removed
                    max_workers=Config.MAX_PARALLEL_WORKERS
                )
            else:
                # Use defaults if performance config not available
                orchestrator = RiskOrchestrator(
                    use_cache=False,
                    max_workers=4
                )

            # Execute the full workflow graph
            comprehensive_report = orchestrator.execute(
                app_id=app_id,
                team_readiness_inputs=team_readiness_inputs,
                business_readiness_inputs=business_readiness_inputs
            )

            # Check for errors
            if comprehensive_report.get('error'):
                error_msg = f"Graph orchestration failed: {comprehensive_report['error']}"
                print(f"ERROR: {error_msg}")
                raise RuntimeError(error_msg)

            # Extract data from comprehensive report
            executive_summary = comprehensive_report.get('executive_summary', {})
            component_analysis = comprehensive_report.get('component_analysis', {})
            scm_analysis = comprehensive_report.get('scm_analysis', {})

            team_readiness_result = comprehensive_report.get('team_readiness', {})
            business_readiness_result = comprehensive_report.get('business_readiness', {})
            complexity_metrics = comprehensive_report.get('complexity_metrics', {})

            # Extract scores
            migration_readiness_score = int(executive_summary.get('migration_readiness_score', 63))
            complexity_score = int(complexity_metrics.get('complexity_score', 50))
            team_readiness = int(team_readiness_result.get('team_readiness_score', 100))
            business_readiness = int(business_readiness_result.get('business_readiness_score', 100))

            # Calculate risk score from component EOSL risk and other factors
            # Using 4-factor approach from migration-application-score.md:
            # - EOSL Risk (40%): Based on EOSL component count
            # - Security Vulnerabilities (25%): From SCM analysis
            # - Business Criticality (20%): TODO - Set to 0 until UI input added
            # - Current Stability (15%): TODO - Set to 0 until UI input added
            eosl_count = component_analysis.get('eosl_components', 0)
            if eosl_count > 0:
                eosl_risk = min(100, eosl_count * 10)
            else:
                eosl_risk = 0

            vulnerability_risk = scm_analysis.get('vulnerability_risk_score', 0)

            # TODO: Add UI inputs for business_criticality and current_stability
            # For now, set to 0 (will be implemented later)
            business_criticality = 0  # TODO: Add UI input
            current_stability = 0      # TODO: Add UI input

            # Calculate weighted risk score using documented weights
            risk_score = int(
                eosl_risk * 0.40 +
                vulnerability_risk * 0.25 +
                business_criticality * 0.20 +
                current_stability * 0.15
            )

            # Calculate overall readiness score (weighted average)
            # Higher score = better/more ready to migrate
            # All components are normalized so higher = better:
            # - Risk is inverted (100 - risk) so low risk = high readiness score
            # - Complexity is inverted (100 - complexity) so low complexity = high readiness score
            # - Migration/Team/Business readiness scores are already high = better
            #
            # Weights: risk=35%, complexity=25%, migration=20%, team=10%, business=10%
            #
            # Note: When there's no SCM data, complexity_score is 0 meaning "unknown" not "simple",
            # so we should not give credit for unknown complexity.
            has_scm_data = bool(scm_analysis.get('source_code_repos'))
            complexity_contribution = (100 - complexity_score) if has_scm_data else 0

            # Invert risk score so that low risk = high readiness
            risk_contribution = 100 - risk_score

            overall_score = int(
                risk_contribution * 0.35 +
                complexity_contribution * 0.25 +
                migration_readiness_score * 0.20 +
                team_readiness * 0.10 +
                business_readiness * 0.10
            )

            # Determine risk level based on overall readiness score
            # High readiness score = Low risk level
            if overall_score >= 70:
                risk_level = 'low'       # 70-100: Ready to migrate, low risk
            elif overall_score >= 50:
                risk_level = 'medium'    # 50-69: Somewhat ready, medium risk
            elif overall_score >= 30:
                risk_level = 'high'      # 30-49: Not very ready, high risk
            else:
                risk_level = 'critical'  # 0-29: Not ready at all, critical risk

            print(f"✓ Assessment complete for app {app_id}:")
            print(f"  Overall Readiness Score: {overall_score}/100")
            print(f"  Risk Level: {risk_level}")
            print(f"  Components: {component_analysis.get('total_components', 0)} total, {component_analysis.get('matched_components', 0)} matched ({component_analysis.get('coverage_percentage', 0)}%)")

            # Build complete detailed report for S3
            detailed_report = {
                'assessment_id': assessment_id,
                'app_id': app_id,
                'assessment_date': assessment_date,
                'overall_score': overall_score,
                'risk_level': risk_level,

                # All scores (higher = better/more ready)
                'scores': {
                    'overall_readiness_score': overall_score,  # 0-100: Overall readiness (higher = more ready)
                    'risk_score': risk_score,                  # 0-100: Risk level (higher = more risk, inverted in overall)
                    'complexity_score': complexity_score,      # 0-100: Complexity (higher = more complex, inverted in overall)
                    'migration_readiness_score': migration_readiness_score,  # 0-100: Technical readiness (higher = more ready)
                    'team_readiness_score': team_readiness,    # 0-100: Team readiness (higher = more ready)
                    'business_readiness_score': business_readiness  # 0-100: Business readiness (higher = more ready)
                },

                # Executive summary
                'executive_summary': executive_summary,

                # Risk assessment details
                'risk_assessment': {
                    'risk_score': risk_score,
                    'risk_level': risk_level,
                    'eosl_risk': eosl_risk,
                    'vulnerability_risk': vulnerability_risk,
                    'business_criticality': business_criticality,
                    'current_stability': current_stability,
                    'eosl_components': component_analysis.get('eosl_components', 0),
                    'eosl_component_list': component_analysis.get('eosl_component_list', []),
                    'risk_factors': {
                        'eosl_risk': {'score': eosl_risk, 'weight': 0.40, 'contribution': eosl_risk * 0.40},
                        'vulnerability_risk': {'score': vulnerability_risk, 'weight': 0.25, 'contribution': vulnerability_risk * 0.25},
                        'business_criticality': {'score': business_criticality, 'weight': 0.20, 'contribution': business_criticality * 0.20},
                        'current_stability': {'score': current_stability, 'weight': 0.15, 'contribution': current_stability * 0.15}
                    }
                },

                # Complexity details — flatten so frontend reads complexity.metrics.* directly
                'complexity': {
                    'complexity_score': complexity_score,
                    'complexity_level': complexity_metrics.get('complexity_level', 'Unknown'),
                    'metrics': complexity_metrics.get('metrics', {}),
                },

                # Migration readiness details
                'migration_readiness': {
                    'readiness_score': migration_readiness_score,
                    'migration_readiness': migration_readiness_score,
                    'factors': {
                        'source_code_available': scm_analysis.get('source_code_score', 0) > 0,
                        'source_code_score': scm_analysis.get('source_code_score', 0),
                        'cicd_maturity': 'basic',
                        'cicd_score': scm_analysis.get('cicd_score', 0),
                        'target_version_coverage': component_analysis.get('coverage_percentage', 0),
                        'target_version_score': int(component_analysis.get('coverage_percentage', 0)),  # Use coverage percentage directly as score
                        'documentation_quality': 'good',
                        'documentation_score': scm_analysis.get('documentation_score', 0),
                        'monitoring_maturity': 'basic',
                        'monitoring_score': scm_analysis.get('monitoring_score', 0),
                        'code_coverage': 60,
                        'coverage_score': scm_analysis.get('code_quality_score', 0)
                    },
                    'component_analysis': {
                        'target_version_coverage': component_analysis.get('coverage_percentage', 0),
                        'eosl_risk_score': eosl_risk,
                        'licensing_risk_score': 0,
                        'version_gap_score': 0,
                        'total_components': component_analysis.get('total_components', 0),
                        'matched_components': component_analysis.get('matched_components', 0),
                        'unmatched_components': component_analysis.get('unmatched_components', 0),
                        'eosl_components': component_analysis.get('eosl_components', 0),
                        'eosl_component_list': component_analysis.get('eosl_component_list', []),
                        'components': component_analysis.get('components', [])  # Include full component details with EOSL data
                    },
                    'scm_analysis': scm_analysis,
                    'blockers': scm_analysis.get('blockers', []),
                    'warnings': scm_analysis.get('warnings', [])
                },

                # Team readiness details
                'team_readiness': {
                    'team_readiness_score': team_readiness,
                    'calculated_score': team_readiness,
                    'inputs': team_readiness_inputs,
                    'details': team_readiness_result
                },

                # Business readiness details
                'business_readiness': {
                    'business_readiness_score': business_readiness,
                    'calculated_score': business_readiness,
                    'inputs': business_readiness_inputs,
                    'details': business_readiness_result
                },

                # Component categories (from comprehensive_report)
                'categories': comprehensive_report.get('categories', {}),

                # Actionable items
                'actionable_items': self.get_actionable_items(
                    app_id,
                    comprehensive_report=comprehensive_report,
                    component_analysis=component_analysis,
                    scm_analysis=scm_analysis,
                ),

                # Note: comprehensive_report intentionally excluded — it duplicates
                # the structured sections above and bloats the S3 JSON (can be 10MB+
                # for repos with many dependencies), causing slow View Details loads.
            }

            # Store complete detailed report to S3
            s3_report_key = None

            try:
                # Config is already imported at module level
                s3_client = self._s3_client
                bucket_name = Config.S3_ARA_BUCKET if PERFORMANCE_CONFIG_AVAILABLE else os.getenv('S3_ARA_BUCKET', os.getenv('S3_ASSETS_BUCKET'))

                if not bucket_name:
                    raise ValueError("S3_ARA_BUCKET is not configured")

                # Store complete detailed report with timestamp prefix for chronological ordering
                # Format: risk-assessments/{app_id}/{timestamp}_{assessment_id}/detailed-report.json
                s3_report_key = f'risk-assessments/{app_id}/{assessment_date}_{assessment_id}/detailed-report.json'
                s3_client.put_object(
                    Bucket=bucket_name,
                    Key=s3_report_key,
                    Body=json.dumps(detailed_report, indent=2, default=str),
                    ContentType='application/json'
                )
                print(f"  Stored complete detailed report to S3: {s3_report_key}")

            except Exception as e:
                print(f"WARNING: Could not store report to S3: {e}")
                import traceback
                traceback.print_exc()

            # Update assessment in DynamoDB with final values
            if self.repository and s3_report_key:
                try:
                    # Update the existing record with final values
                    updates = {
                        'overall_score': Decimal(str(overall_score)),
                        'risk_level': risk_level,
                        's3_report_key': s3_report_key,
                        's3_bucket': bucket_name,
                        'assessment_date': assessment_date
                    }
                    self.repository.update_assessment(assessment_id, app_id, updates)
                    print(f"  Assessment metadata updated in DynamoDB with ID: {assessment_id}")
                except Exception as e:
                    print(f"ERROR: Could not update assessment in DynamoDB: {e}")
                    import traceback
                    traceback.print_exc()

            # Return simplified result for in-memory storage
            result = {
                'assessment_id': assessment_id,
                'app_id': app_id,
                'overall_score': overall_score,
                'risk_level': risk_level,
                'assessment_date': assessment_date,
                's3_report_key': s3_report_key
            }

            return result

        except Exception as e:
            print(f"ERROR: Graph-based assessment failed: {e}")
            import traceback
            traceback.print_exc()
            raise
