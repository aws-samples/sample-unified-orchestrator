"""
StrandAgent - Migration orchestration agent using Strands SDK

This agent coordinates risk assessment tools for application migration using AWS Bedrock.
It uses the Strands SDK Agent class with custom risk assessment tools:
- analyze_risk: Calculate overall risk score
- calculate_complexity: Assess migration complexity
- assess_migration_readiness: Evaluate technical readiness
- assess_team_readiness: Evaluate team preparedness
- assess_business_readiness: Evaluate business preparedness

The agent supports:
- Natural language invocation of tools
- Direct method calls on agent object
- Auto-loading of tools from ./tools/ directory
- AWS Bedrock integration for AI capabilities
"""

import logging
import os
from typing import Dict, Any, Optional, List
from strands import Agent
from strands.models import BedrockModel

# Import risk tools - tools will be auto-discovered by Strands SDK
from .tools import risks

logger = logging.getLogger(__name__)


class StrandAgent:
    """
    Migration orchestration agent using Strands SDK.

    This agent wraps the Strands SDK Agent class and provides a unified interface
    for executing various migration-related tasks using AI-powered tools.

    Features:
    - Natural language tool invocation
    - Direct method calls (e.g., agent.analyze_risk(...))
    - Auto-loading of tools from modules
    - AWS Bedrock integration for AI capabilities
    """

    def __init__(
        self,
        model_id: str = None,
        region: str = None,
        load_tools_from_directory: bool = True,
        bedrock_client=None,
        **kwargs
    ):
        """
        Initialize the StrandAgent with Strands SDK Agent.

        Args:
            model_id: AWS Bedrock model ID to use (default: from BEDROCK_MODEL_ID env var)
            region: AWS region for Bedrock (default: from AWS_REGION env var or us-east-1)
            load_tools_from_directory: Auto-load tools from ./tools/ directory (default: True)
            bedrock_client: Optional boto3 Bedrock client (for testing)
            **kwargs: Additional arguments passed to Strands Agent
        """
        logger.info("Initializing StrandAgent with Strands SDK")

        # Get configuration from environment variables with fallbacks
        # Use AI Model for better context window and on-demand throughput support
        model_id = model_id or os.getenv('BEDROCK_MODEL_ID')
        region = region or os.getenv('AWS_REGION', 'us-east-1')

        logger.info(f"Using model: {model_id}, region: {region}")

        # Collect all tools from risk tools module
        tools = [risks]

        # Create Bedrock model with the specified configuration
        # If bedrock_client is provided (for testing), we'll pass it via boto_session
        if bedrock_client:
            # For testing: create a mock session that returns the mock client
            import boto3
            from unittest.mock import Mock
            mock_session = Mock(spec=boto3.Session)
            mock_session.client.return_value = bedrock_client
            model = BedrockModel(
                boto_session=mock_session,
                model_id=model_id
            )
        else:
            # For production: use default boto3 session
            model = BedrockModel(
                region_name=region,
                model_id=model_id
            )

        # Initialize Strands SDK Agent with model and tools
        self.agent = Agent(
            model=model,
            tools=tools,
            load_tools_from_directory=False,
            **kwargs
        )

        logger.info(f"StrandAgent initialized with {len(self.agent.tool_names)} tools")
        logger.info(f"Available tools: {', '.join(self.agent.tool_names)}")

    def chat(self, message: str, **kwargs) -> str:
        """
        Send a message to the agent for natural language tool invocation.

        The agent will determine which tools to use based on the message content.

        Args:
            message: Natural language message/request
            **kwargs: Additional arguments passed to agent()

        Returns:
            Agent's response as a string

        Raises:
            RuntimeError: If Bedrock call fails after retries (with structured detail)

        Example:
            response = agent.chat("Analyze the risk for application APP-123")
        """
        import botocore.exceptions

        logger.info(f"Processing chat message: {message[:100]}...")
        try:
            return self.agent(message, **kwargs)
        except botocore.exceptions.ClientError as e:
            error_code = e.response['Error']['Code']
            error_msg = e.response['Error']['Message']
            logger.error(f"StrandAgent Bedrock error: {error_code} — {error_msg}")
            raise RuntimeError(
                f"AI agent call failed ({error_code}): {error_msg}"
            ) from e
        except (botocore.exceptions.ReadTimeoutError,
                botocore.exceptions.ConnectTimeoutError,
                botocore.exceptions.EndpointConnectionError) as e:
            logger.error(f"StrandAgent network error: {type(e).__name__}: {e}")
            raise RuntimeError(
                f"AI agent unreachable ({type(e).__name__}): {e}"
            ) from e

    def structured_output(self, model_class, message: str, **kwargs):
        """
        Get structured output from the agent using a Pydantic model.

        Args:
            model_class: Pydantic model class defining the output structure
            message: Natural language message/request
            **kwargs: Additional arguments

        Returns:
            Instance of model_class with validated data

        Example:
            class Result(BaseModel):
                score: int
                details: str

            result = agent.structured_output(Result, "Analyze this...")
        """
        logger.info(f"Getting structured output for: {message[:100]}...")
        return self.agent.structured_output(model_class, message, **kwargs)

    def __getattr__(self, name: str):
        """
        Delegate attribute access to the underlying Strands Agent.

        This allows direct method calls like agent.analyze_risk(...)
        where analyze_risk is a tool loaded into the agent.
        """
        # First try to get from the agent
        if hasattr(self.agent, name):
            return getattr(self.agent, name)

        # If not found, raise AttributeError
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    @property
    def tool_names(self) -> List[str]:
        """
        Get list of available tool names.

        Returns:
            List of tool names loaded in the agent
        """
        return self.agent.tool_names

    @property
    def tool_config(self) -> Dict[str, Any]:
        """
        Get tool configuration including descriptions and input schemas.

        Returns:
            Dictionary containing tool configurations
        """
        return self.agent.tool_config

    def get_tool_info(self) -> Dict[str, Any]:
        """
        Get detailed information about all registered tools.

        Returns:
            Dict containing tool information organized by tool name
        """
        tool_info = {}

        for tool_name in self.tool_names:
            # Get tool config from agent
            tool_config = self.tool_config.get(tool_name, {})

            tool_info[tool_name] = {
                'name': tool_name,
                'description': tool_config.get('description', 'No description available'),
                'input_schema': tool_config.get('inputSchema', {}),
            }

        return tool_info

    def health_check(self) -> Dict[str, Any]:
        """
        Perform health check on the StrandAgent and its components.

        Returns:
            Dict containing health status of all components
        """
        health_status = {
            'agent': 'healthy',
            'tools_loaded': len(self.tool_names),
            'tool_names': self.tool_names,
            'model': str(getattr(self.agent, 'model', 'unknown')),
        }

        return health_status

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        # Strands Agent handles cleanup
        return False
