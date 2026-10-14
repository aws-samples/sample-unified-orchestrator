"""Bedrock Client Utility - retry logic and structured error handling for AWS Bedrock."""
import json
import time
import logging
import botocore.exceptions

logger = logging.getLogger(__name__)

RETRYABLE_ERROR_CODES = frozenset({
    'ThrottlingException', 'ModelTimeoutException', 'ModelNotReadyException',
    'ServiceUnavailableException', 'InternalServerException',
})

_USER_MESSAGES = {
    'ThrottlingException': 'AI analysis is temporarily rate-limited. Please try again in a moment.',
    'ModelTimeoutException': 'AI analysis timed out. The model is responding slowly.',
    'ModelNotReadyException': 'AI model is warming up. Please try again in a few seconds.',
    'ServiceUnavailableException': 'AI analysis service is temporarily unavailable.',
    'InternalServerException': 'AI analysis service encountered an internal error.',
    'AccessDeniedException': 'AI analysis unavailable — permissions issue.',
    'ValidationException': 'AI analysis request was invalid.',
    'ResourceNotFoundException': 'AI model not found. Check BEDROCK_MODEL_ID configuration.',
    'ModelErrorException': 'AI model encountered an error. Falling back to rule-based analysis.',
}


def invoke_bedrock_with_retry(client, model_id: str, body: dict, max_retries: int = 3,
                               base_delay: float = 1.0, context: dict = None) -> tuple:
    ctx = context or {}
    ctx_str = ' '.join(f'{k}={v}' for k, v in ctx.items()) if ctx else ''
    body_json = json.dumps(body)

    for attempt in range(max_retries + 1):
        start_time = time.time()
        try:
            response = client.invoke_model(
                modelId=model_id, body=body_json,
                contentType='application/json', accept='application/json',
            )
            response_body = json.loads(response['body'].read())
            return response_body, None

        except botocore.exceptions.ClientError as e:
            error_code = e.response['Error']['Code']
            error_message = e.response['Error']['Message']
            if error_code in RETRYABLE_ERROR_CODES and attempt < max_retries:
                wait_time = base_delay * (2 ** attempt)
                logger.warning(f"Bedrock {error_code} attempt {attempt + 1}. Retrying in {wait_time:.1f}s...")
                time.sleep(wait_time)
                continue
            return None, {
                'error_type': error_code,
                'message': _USER_MESSAGES.get(error_code, 'An unexpected AI analysis error occurred.'),
                'detail': error_message, 'retryable': error_code in RETRYABLE_ERROR_CODES,
                'attempts': attempt + 1,
            }

        except (botocore.exceptions.ReadTimeoutError, botocore.exceptions.ConnectTimeoutError,
                botocore.exceptions.EndpointConnectionError) as e:
            if attempt < max_retries:
                time.sleep(base_delay * (2 ** attempt))
                continue
            return None, {
                'error_type': 'NETWORK_ERROR', 'message': 'AI analysis service is unreachable.',
                'detail': str(e), 'retryable': True, 'attempts': attempt + 1,
            }

        except json.JSONDecodeError as e:
            return None, {
                'error_type': 'PARSE_ERROR', 'message': 'AI analysis returned an invalid response.',
                'detail': str(e), 'retryable': False, 'attempts': attempt + 1,
            }

        except Exception as e:
            return None, {
                'error_type': 'UNEXPECTED_ERROR', 'message': 'An unexpected error occurred during AI analysis.',
                'detail': f'{type(e).__name__}: {e}', 'retryable': False, 'attempts': attempt + 1,
            }

    return None, {
        'error_type': 'MAX_RETRIES_EXHAUSTED', 'message': 'AI analysis failed after multiple attempts.',
        'detail': f'Exhausted {max_retries + 1} attempts', 'retryable': True, 'attempts': max_retries + 1,
    }
