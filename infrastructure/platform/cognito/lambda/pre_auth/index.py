"""
Cognito Pre-Authentication Lambda Trigger.
"""

import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event, context):
    # Log only non-PII trigger metadata — never the full event (contains user attributes/PII).
    logger.info(
        "Pre-auth trigger: source=%s pool=%s sub=%s",
        event.get("triggerSource"),
        event.get("userPoolId"),
        (event.get("request", {}).get("userAttributes", {}) or {}).get("sub"),
    )
    return event
