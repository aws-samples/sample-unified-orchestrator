"""HTML report generator for risk assessment reports."""
from typing import Dict, Any
from datetime import datetime


def generate_html_report(report: Dict[str, Any]) -> str:
    """Generate an HTML report from a risk assessment JSON report."""
    app_id = report.get('app_id', 'Unknown')
    assessment_id = report.get('assessment_id', 'Unknown')
    overall_score = report.get('overall_score', 0)
    risk_level = report.get('risk_level', 'unknown')
    assessment_date = report.get('assessment_date', 0)

    # Format date
    try:
        date_str = datetime.fromtimestamp(int(assessment_date)).strftime('%B %d, %Y %H:%M:%S')
    except (ValueError, TypeError, OSError):
        date_str = str(assessment_date)

    scores = report.get('scores', {})
    executive_summary = report.get('executive_summary', {})
    risk_assessment = report.get('risk_assessment', {})
    complexity = report.get('complexity', {})
    migration = report.get('migration_readiness', {})
    team = report.get('team_readiness', {})
    business = report.get('business_readiness', {})
    actionable_items = report.get('actionable_items', [])

    risk_color = _risk_color(risk_level)

    # Build component table rows
    components = migration.get('component_analysis', {}).get('components', [])
    component_rows = _build_component_rows(components)

    # Build actionable items rows
    action_rows = _build_action_rows(actionable_items)

    # Risk factors
    risk_factors = risk_assessment.get('risk_factors', {})

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Risk Assessment Report - App {app_id}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #333; }}
  .container {{ max-width: 1100px; margin: 0 auto; }}
  .header {{ background: #1a1a2e; color: white; padding: 30px; border-radius: 8px 8px 0 0; }}
  .header h1 {{ margin: 0 0 8px 0; font-size: 24px; }}
  .header .meta {{ opacity: 0.8; font-size: 14px; }}
  .score-banner {{ display: flex; gap: 20px; padding: 20px 30px; background: white; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }}
  .score-card {{ text-align: center; min-width: 120px; }}
  .score-card .value {{ font-size: 28px; font-weight: bold; }}
  .score-card .label {{ font-size: 12px; color: #666; text-transform: uppercase; }}
  .risk-badge {{ display: inline-block; padding: 4px 12px; border-radius: 4px; color: white; font-weight: bold; text-transform: uppercase; background: {risk_color}; }}
  .section {{ background: white; padding: 24px 30px; border-bottom: 1px solid #e0e0e0; }}
  .section:last-child {{ border-radius: 0 0 8px 8px; }}
  .section h2 {{ margin: 0 0 16px 0; font-size: 18px; color: #1a1a2e; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
  th {{ background: #f8f9fa; text-align: left; padding: 10px 12px; border-bottom: 2px solid #dee2e6; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #eee; }}
  .bar {{ height: 8px; border-radius: 4px; background: #e0e0e0; }}
  .bar-fill {{ height: 100%; border-radius: 4px; }}
  .priority-high {{ color: #dc3545; font-weight: bold; }}
  .priority-medium {{ color: #fd7e14; }}
  .priority-low {{ color: #28a745; }}
  .summary-text {{ line-height: 1.6; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Migration Risk Assessment Report</h1>
    <div class="meta">Application ID: {app_id} &nbsp;|&nbsp; Assessment: {assessment_id} &nbsp;|&nbsp; {date_str}</div>
  </div>

  <div class="score-banner">
    <div class="score-card"><div class="value">{overall_score}</div><div class="label">Overall Readiness</div></div>
    <div class="score-card"><div class="value"><span class="risk-badge">{risk_level}</span></div><div class="label">Risk Level</div></div>
    <div class="score-card"><div class="value">{scores.get('risk_score', 0)}</div><div class="label">Risk Score</div></div>
    <div class="score-card"><div class="value">{scores.get('complexity_score', 0)}</div><div class="label">Complexity</div></div>
    <div class="score-card"><div class="value">{scores.get('migration_readiness_score', 0)}</div><div class="label">Migration Readiness</div></div>
    <div class="score-card"><div class="value">{scores.get('team_readiness_score', 0)}</div><div class="label">Team Readiness</div></div>
    <div class="score-card"><div class="value">{scores.get('business_readiness_score', 0)}</div><div class="label">Business Readiness</div></div>
  </div>
"""
    # Executive Summary
    summary_text = executive_summary.get('summary', executive_summary.get('overview', ''))
    if summary_text:
        html += f"""
  <div class="section">
    <h2>Executive Summary</h2>
    <div class="summary-text">{summary_text}</div>
  </div>
"""

    # Risk Factors
    html += """
  <div class="section">
    <h2>Risk Factors</h2>
    <table>
      <tr><th>Factor</th><th>Score</th><th>Weight</th><th>Contribution</th></tr>
"""
    for name, data in risk_factors.items():
        if isinstance(data, dict):
            label = name.replace('_', ' ').title()
            html += f"      <tr><td>{label}</td><td>{data.get('score', 0)}</td><td>{data.get('weight', 0):.0%}</td><td>{data.get('contribution', 0):.1f}</td></tr>\n"
    html += """    </table>
  </div>
"""

    # Component Analysis
    comp_analysis = migration.get('component_analysis', {})
    total = comp_analysis.get('total_components', 0)
    matched = comp_analysis.get('matched_components', 0)
    eosl = comp_analysis.get('eosl_components', 0)

    html += f"""
  <div class="section">
    <h2>Component Analysis</h2>
    <p>Total: {total} &nbsp;|&nbsp; Matched: {matched} &nbsp;|&nbsp; EOSL: {eosl}</p>
"""
    if component_rows:
        html += """    <table>
      <tr><th>Component</th><th>Current Version</th><th>Target Version</th><th>EOSL</th></tr>
"""
        html += component_rows
        html += "    </table>\n"
    html += "  </div>\n"

    # Actionable Items
    if action_rows:
        html += """
  <div class="section">
    <h2>Actionable Items</h2>
    <table>
      <tr><th>Priority</th><th>Category</th><th>Description</th></tr>
"""
        html += action_rows
        html += "    </table>\n  </div>\n"

    html += """
</div>
</body>
</html>"""
    return html


def _risk_color(level: str) -> str:
    return {
        'critical': '#dc3545',
        'high': '#fd7e14',
        'medium': '#ffc107',
        'low': '#28a745',
    }.get(level, '#6c757d')


def _build_component_rows(components: list) -> str:
    rows = ""
    for c in components[:100]:  # Limit to 100 rows
        publisher = c.get('publisher', '')
        product = c.get('product', '')
        name = f"{publisher} {product}".strip() if (publisher or product) else c.get('name', c.get('component_name', ''))
        current = c.get('full_version', c.get('current_version', c.get('version', '')))
        target_raw = c.get('target_version', '')
        if isinstance(target_raw, dict):
            target = target_raw.get('version', 'Not Available')
        else:
            target = target_raw or 'Not Available'
        eosl_status = str(c.get('eosl_status', ''))
        is_eosl = eosl_status == '4' or c.get('is_eosl') or c.get('eosl')
        eosl = 'Yes' if is_eosl else 'No'
        eosl_style = ' style="color:#dc3545;font-weight:bold"' if eosl == 'Yes' else ''
        rows += f"      <tr><td>{name}</td><td>{current}</td><td>{target}</td><td{eosl_style}>{eosl}</td></tr>\n"
    return rows


def _build_action_rows(items: list) -> str:
    rows = ""
    for item in items:
        if isinstance(item, dict):
            priority = item.get('priority', 'medium')
            category = item.get('category', '')
            desc = item.get('description', item.get('title', ''))
            css_class = f"priority-{priority}"
            rows += f'      <tr><td class="{css_class}">{priority.upper()}</td><td>{category}</td><td>{desc}</td></tr>\n'
    return rows
