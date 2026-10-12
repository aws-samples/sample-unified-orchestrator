"""
SCM Analysis Tool

Analyzes source code management data including CI/CD maturity, code quality,
vulnerabilities, documentation, monitoring, and complexity.

Supports two modes:
- Rule-based (default): Deterministic scoring using the migration-application-score.md
  framework. Same inputs always produce the same scores.
- AI-based (fallback): Uses AWS Bedrock for AI-powered assessment. Non-deterministic
  but can provide nuanced recommendations. Enable via USE_AI_SCM_ANALYSIS=true in .env.
"""

import logging
import json
import os
from strands import tool

logger = logging.getLogger(__name__)


@tool
def analyze_scm(
    app_id: str,
    scm_data: dict = None,
    cicd_data: dict = None,
    code_quality_data: dict = None
) -> dict:
    """
    Analyze source code management and development practices using AI.

    This tool evaluates technical readiness factors including:
    - Source code availability and documentation
    - CI/CD maturity and automation level
    - Code quality metrics (coverage, complexity, vulnerabilities)
    - Documentation quality and completeness
    - Monitoring and observability setup
    - Integration complexity

    The tool uses AWS Bedrock AI to intelligently assess the data and provide
    actionable recommendations for improving migration readiness.

    Args:
        app_id: Application ID to analyze
        scm_data: Source code management data including:
            - source_code_available: bool
            - source_code_documented: bool
            - repository_url: str
            - code_coverage: float (0-100)
            - lines_of_code: int
        cicd_data: CI/CD pipeline data including:
            - cicd_maturity: str (none, manual, scripted, basic, full, advanced)
            - build_automation: bool
            - deployment_automation: bool
            - pipeline_url: str
        code_quality_data: Code quality metrics including:
            - vulnerabilities: int
            - code_smells: int
            - technical_debt_hours: int
            - complexity_score: int
            - documentation_quality: str (none, basic, good, excellent)
            - monitoring_maturity: str (none, basic, centralized, full, advanced)
            - integration_count: int

    Returns:
        Dictionary containing:
        - source_code_score: Score for source code availability (0-100)
        - cicd_score: Score for CI/CD maturity (0-100)
        - code_quality_score: Score for code quality (0-100)
        - documentation_score: Score for documentation (0-100)
        - monitoring_score: Score for monitoring setup (0-100)
        - vulnerability_risk_score: Risk score for security vulnerabilities (0-100)
        - complexity_score: Complexity score based on integrations and code (0-100)
        - overall_scm_readiness: Overall SCM readiness score (0-100)
        - recommendations: List of actionable recommendations
        - blockers: List of critical blockers
        - warnings: List of warnings
    """
    logger.info(f"Analyzing SCM data for application {app_id}")

    # Initialize default data structures
    scm_data = scm_data or {}
    cicd_data = cicd_data or {}
    code_quality_data = code_quality_data or {}

    # Use rule-based scoring by default (deterministic).
    # Set USE_AI_SCM_ANALYSIS=true in .env to fall back to Bedrock AI.
    use_ai = os.getenv('USE_AI_SCM_ANALYSIS', 'false').lower() == 'true'

    if use_ai:
        logger.info(f"Using AI-based SCM analysis for {app_id}")
        analysis_result = _ai_analyze_scm(app_id, scm_data, cicd_data, code_quality_data)
    else:
        logger.info(f"Using rule-based SCM analysis for {app_id}")
        analysis_result = _rule_based_analyze_scm(app_id, scm_data, cicd_data, code_quality_data)

    logger.info(f"SCM analysis complete for {app_id}: overall readiness = {analysis_result.get('overall_scm_readiness', 0)}")

    return analysis_result


def _rule_based_analyze_scm(app_id, scm_data, cicd_data, code_quality_data):
    """
    Deterministic SCM scoring based on migration-application-score.md framework.

    Produces identical scores for identical inputs — no AI, no Bedrock dependency.
    Return shape matches _ai_analyze_scm exactly so callers are unaffected.
    """

    # --- 1. Source Code Score (Readiness Dimension 3, 25% weight) ---
    source_available = scm_data.get('source_code_available', False)
    source_documented = scm_data.get('source_code_documented', False)
    if source_available and source_documented:
        source_code_score = 100
    elif source_available:
        source_code_score = 50
    else:
        source_code_score = 0

    # --- 2. CI/CD Score (Readiness Dimension 3, 20% weight) ---
    cicd_maturity = (cicd_data.get('cicd_maturity') or 'none').lower().strip()
    cicd_score_map = {
        'advanced': 100, 'full ci/cd': 100, 'full': 100,
        'ci only': 75, 'basic ci/cd': 75, 'basic': 75,
        'scripted': 50, 'build only': 50,
        'manual': 25, 'iac only': 25, 'minimal': 25,
        'none': 0,
    }
    cicd_score = cicd_score_map.get(cicd_maturity, 0)

    # Bonus: if build + deploy automation both present, bump to at least 75
    if cicd_data.get('build_automation') and cicd_data.get('deployment_automation'):
        cicd_score = max(cicd_score, 75)

    # --- 3. Code Quality / Coverage Score (Readiness Dimension 3, 10% weight) ---
    coverage = scm_data.get('code_coverage', 0) or 0
    if coverage >= 70:
        code_quality_score = 100
    elif coverage >= 50:
        code_quality_score = 50
    elif coverage >= 30:
        code_quality_score = 25
    else:
        code_quality_score = 0

    # --- 4. Documentation Score (Readiness Dimension 3, 15% weight) ---
    doc_quality = (code_quality_data.get('documentation_quality') or 'none').lower().strip()
    doc_score_map = {
        'comprehensive': 100, 'excellent': 100,
        'good': 75,
        'basic': 50, 'fair': 50,
        'minimal': 25, 'poor': 25,
        'none': 0,
    }
    documentation_score = doc_score_map.get(doc_quality, 0)

    # --- 5. Monitoring Score (Readiness Dimension 3, 10% weight) ---
    mon_maturity = (code_quality_data.get('monitoring_maturity') or 'none').lower().strip()
    mon_score_map = {
        'comprehensive': 100, 'full': 100, 'advanced': 100,
        'good': 75, 'centralized': 75,
        'basic': 50,
        'minimal': 25, 'logs only': 25,
        'none': 0,
    }
    monitoring_score = mon_score_map.get(mon_maturity, 0)

    # --- 6. Vulnerability Risk Score (higher = worse) ---
    vulns = code_quality_data.get('vulnerabilities', 0) or 0
    if vulns == 0:
        vulnerability_risk_score = 0
    elif vulns <= 3:
        vulnerability_risk_score = 30
    elif vulns <= 10:
        vulnerability_risk_score = 60
    else:
        vulnerability_risk_score = 100

    # --- 7. Complexity Score (integration-based, for reference only) ---
    integration_count = code_quality_data.get('integration_count', 0) or 0
    if integration_count <= 5:
        complexity_score = 20
    elif integration_count <= 15:
        complexity_score = 45
    elif integration_count <= 30:
        complexity_score = 70
    else:
        complexity_score = 100

    # --- 8. Overall SCM Readiness (weighted average per framework doc) ---
    overall_scm_readiness = round(
        source_code_score * 0.25 +
        cicd_score * 0.20 +
        code_quality_score * 0.20 +
        documentation_score * 0.15 +
        monitoring_score * 0.10 +
        (100 - vulnerability_risk_score) * 0.10
    )

    # --- 9. Blockers, Warnings, Recommendations ---
    blockers = []
    warnings = []
    recommendations = []

    # Blockers
    if source_code_score == 0:
        blockers.append({
            'type': 'source_code', 'severity': 'critical',
            'message': 'No source code available — migration cannot proceed.',
            'action': 'Recover source code from version control or reverse-engineer from deployed artifacts.'
        })

    # Warnings
    if cicd_score == 0:
        warnings.append({
            'type': 'cicd', 'severity': 'high',
            'message': 'No CI/CD pipeline detected.',
            'action': 'Set up at least a basic CI pipeline before migration to enable automated testing and rollback.'
        })
    if monitoring_score == 0:
        warnings.append({
            'type': 'monitoring', 'severity': 'medium',
            'message': 'No monitoring or observability detected.',
            'action': 'Implement basic logging and health checks to validate migration success.'
        })
    if code_quality_score == 0:
        warnings.append({
            'type': 'quality', 'severity': 'medium',
            'message': f'Code coverage is very low ({coverage}%).',
            'action': 'Add automated tests for critical paths before migration to reduce risk.'
        })
    if documentation_score <= 25:
        warnings.append({
            'type': 'documentation', 'severity': 'medium',
            'message': f'Documentation quality is {doc_quality}.',
            'action': 'Document architecture, dependencies, and deployment procedures before migration.'
        })

    # Recommendations (for scores below threshold)
    if source_code_score == 50:
        recommendations.append({
            'priority': 'medium', 'category': 'source_code',
            'message': 'Source code is available but not well-documented.',
            'action': 'Add inline documentation and architecture diagrams to improve migration confidence.'
        })
    if cicd_score <= 50 and cicd_score > 0:
        recommendations.append({
            'priority': 'medium', 'category': 'cicd',
            'message': f'CI/CD maturity is "{cicd_maturity}" — partial automation only.',
            'action': 'Upgrade to full CI/CD with automated testing and deployment to reduce migration risk.'
        })
    if vulnerability_risk_score > 0:
        recommendations.append({
            'priority': 'high' if vulnerability_risk_score >= 60 else 'medium',
            'category': 'security',
            'message': f'{vulns} security vulnerabilities detected (risk score {vulnerability_risk_score}/100).',
            'action': 'Remediate critical and high-severity vulnerabilities before migration.'
        })
    if monitoring_score <= 50 and monitoring_score > 0:
        recommendations.append({
            'priority': 'low', 'category': 'monitoring',
            'message': f'Monitoring maturity is "{mon_maturity}".',
            'action': 'Consider adding centralized logging and distributed tracing for post-migration validation.'
        })

    logger.info(f"Rule-based SCM analysis for {app_id}: source={source_code_score}, cicd={cicd_score}, "
                f"quality={code_quality_score}, docs={documentation_score}, monitoring={monitoring_score}, "
                f"vuln_risk={vulnerability_risk_score}, overall={overall_scm_readiness}")

    return {
        'source_code_score': source_code_score,
        'cicd_score': cicd_score,
        'code_quality_score': code_quality_score,
        'documentation_score': documentation_score,
        'monitoring_score': monitoring_score,
        'vulnerability_risk_score': vulnerability_risk_score,
        'complexity_score': complexity_score,
        'overall_scm_readiness': overall_scm_readiness,
        'blockers': blockers,
        'warnings': warnings,
        'recommendations': recommendations,
    }


def _ai_analyze_scm(app_id, scm_data, cicd_data, code_quality_data):
    """
    Use AI to analyze SCM data and provide intelligent scoring and recommendations.

    This uses prompt engineering with Bedrock to assess the data holistically.
    Falls back to rule-based scoring if Bedrock call fails for any reason.
    """
    import os
    from app.utils.bedrock_client import invoke_bedrock_with_retry

    # Initialize Bedrock client
    from app.config import Config
    bedrock_client = Config.get_boto3_client('bedrock-runtime')
    model_id = os.getenv('BEDROCK_MODEL_ID')

    # Create prompt for AI analysis
    prompt = f"""Analyze the source code management and development practices for application {app_id}.

**Source Code Management:**
- Source Code Available: {scm_data.get('source_code_available', False)}
- Source Code Documented: {scm_data.get('source_code_documented', False)}
- Code Coverage: {scm_data.get('code_coverage', 0)}%
- Lines of Code: {scm_data.get('lines_of_code', 'Unknown')}

**CI/CD Pipeline:**
- CI/CD Maturity: {cicd_data.get('cicd_maturity', 'none')}
- Build Automation: {cicd_data.get('build_automation', False)}
- Deployment Automation: {cicd_data.get('deployment_automation', False)}

**Code Quality:**
- Security Vulnerabilities: {code_quality_data.get('vulnerabilities', 0)}
- Code Smells: {code_quality_data.get('code_smells', 0)}
- Technical Debt: {code_quality_data.get('technical_debt_hours', 0)} hours
- Cyclomatic Complexity: {code_quality_data.get('complexity_score', 0)}
- Documentation Quality: {code_quality_data.get('documentation_quality', 'none')}
- Monitoring Maturity: {code_quality_data.get('monitoring_maturity', 'none')}
- Integration Count: {code_quality_data.get('integration_count', 0)}

**Task:** Analyze this data and provide scores (0-100) for each factor. Consider:

1. **Source Code Score (0-100):**
   - 100: Source code available and well-documented
   - 50: Source code available but poorly documented
   - 0: Source code not available (BLOCKER)

2. **CI/CD Score (0-100):**
   - 100: Full automation (advanced CI/CD)
   - 75: Good automation (basic CI/CD)
   - 50: Partial automation (scripted)
   - 25: Manual processes
   - 0: No CI/CD

3. **Code Quality Score (0-100):**
   - Based on coverage, vulnerabilities, code smells, technical debt
   - Higher coverage = higher score
   - More vulnerabilities = lower score

4. **Documentation Score (0-100):**
   - 100: Excellent/comprehensive documentation
   - 75: Good documentation
   - 50: Basic/fair documentation
   - 25: Poor documentation
   - 0: No documentation

5. **Monitoring Score (0-100):**
   - 100: Advanced/full observability
   - 75: Centralized logging and monitoring
   - 50: Basic monitoring
   - 25: Logs only
   - 0: No monitoring

6. **Vulnerability Risk Score (0-100, higher is worse):**
   - 0: No vulnerabilities
   - 30: 1-3 vulnerabilities (low risk)
   - 60: 4-10 vulnerabilities (medium risk)
   - 100: 10+ vulnerabilities (high risk)

7. **Complexity Score (0-100, higher is more complex):**
   - Based on integration count, lines of code, cyclomatic complexity
   - 0-5 integrations = 10-30 pts
   - 6-15 integrations = 30-60 pts
   - 16+ integrations = 60-100 pts

8. **Overall SCM Readiness (0-100):**
   - Weighted average: source(25%) + cicd(20%) + quality(20%) + docs(15%) + monitoring(10%) + (100-vulnerability)(10%)

**Output Format (JSON only, no additional text):**
```json
{{
  "source_code_score": <number>,
  "cicd_score": <number>,
  "code_quality_score": <number>,
  "documentation_score": <number>,
  "monitoring_score": <number>,
  "vulnerability_risk_score": <number>,
  "complexity_score": <number>,
  "overall_scm_readiness": <number>,
  "blockers": [
    {{"type": "source_code|cicd|security", "severity": "critical", "message": "...", "action": "..."}}
  ],
  "warnings": [
    {{"type": "documentation|monitoring|quality", "severity": "high|medium", "message": "...", "action": "..."}}
  ],
  "recommendations": [
    {{"priority": "high|medium|low", "category": "...", "message": "...", "action": "..."}}
  ]
}}
```

Provide the JSON response now."""

    # Call Bedrock with retry and structured error handling
    request_body = {
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {
            "maxTokens": 2000,
            "temperature": 0.1
        }
    }

    response_body, error = invoke_bedrock_with_retry(
        client=bedrock_client,
        model_id=model_id,
        body=request_body,
        max_retries=3,
        context={'app_id': app_id, 'operation': 'ai_scm_analysis'},
    )

    if error:
        logger.warning(
            f"Bedrock AI SCM analysis failed for {app_id}: {error['error_type']} — "
            f"{error['detail']}. Falling back to rule-based analysis."
        )
        result = _rule_based_analyze_scm(app_id, scm_data, cicd_data, code_quality_data)
        result['analysis_mode'] = 'rule_based_fallback'
        result['ai_error'] = error
        return result

    # Parse AI response — support both Nova and Claude formats
    if 'output' in response_body:
        ai_response = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()
    else:
        ai_response = response_body.get('content', [{}])[0].get('text', '').strip()

    import re
    json_match = re.search(r'```json\s*(.*?)\s*```', ai_response, re.DOTALL)
    if json_match:
        json_str = json_match.group(1)
    else:
        json_match = re.search(r'\{.*\}', ai_response, re.DOTALL)
        json_str = json_match.group(0) if json_match else None

    if json_str:
        try:
            result = json.loads(json_str)
            result['analysis_mode'] = 'ai'
            logger.info(f"AI SCM analysis successful for {app_id}")
            return result
        except json.JSONDecodeError as e:
            logger.warning(
                f"AI response JSON parse failed for {app_id}: {e}. "
                f"Falling back to rule-based analysis."
            )
            result = _rule_based_analyze_scm(app_id, scm_data, cicd_data, code_quality_data)
            result['analysis_mode'] = 'rule_based_fallback'
            result['ai_error'] = {
                'error_type': 'PARSE_ERROR',
                'message': 'AI returned malformed JSON.',
                'detail': str(e),
            }
            return result
    else:
        logger.warning(
            f"No valid JSON found in AI response for {app_id}. "
            f"Falling back to rule-based analysis."
        )
        result = _rule_based_analyze_scm(app_id, scm_data, cicd_data, code_quality_data)
        result['analysis_mode'] = 'rule_based_fallback'
        result['ai_error'] = {
            'error_type': 'PARSE_ERROR',
            'message': 'AI response contained no valid JSON.',
            'detail': f'Response length: {len(ai_response)} chars',
        }
        return result
