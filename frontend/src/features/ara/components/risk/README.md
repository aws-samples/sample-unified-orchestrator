# Risk Assessment Components

## Overview

This directory contains the risk assessment UI components that integrate with Strands agents for automated risk analysis.

## Components

### RiskSummaryTab

The `RiskSummaryTab` component displays the comprehensive risk assessment results from Strands agents.

#### Features

1. **Overall Application Readiness Score (0-100)**
   - Displays the calculated application readiness score from Strands risk tools
   - Shows score label (Excellent, Good, Fair, Poor, Critical)
   - Visual progress bar with color coding

2. **Actionable Items**
   - Lists EOSL risks identified by Strands agents
   - Shows security CVEs from vulnerability analysis
   - Displays blockers preventing migration
   - Provides warnings and recommendations
   - Each item includes:
     - Type badge (EOSL Risk, Security CVE, Blocker, Warning)
     - Severity badge (Critical, High, Medium, Low)
     - Description and recommendation

3. **Score Breakdown Visualization**
   - Bar chart showing all 5 assessment dimensions
   - Individual progress bars for each score:
     - Risk Score (40% weight)
     - Complexity Score (25% weight)
     - Migration Readiness Score (15% weight)
     - Team Readiness Score (10% weight)
     - Business Readiness Score (10% weight)

#### Integration with Strands Agents

The component is designed to consume data from Strands agents via the backend API:

```typescript
interface RiskSummaryData {
  overallPriorityScore: number        // From calculate_final_priority tool
  actionableItems: ActionableItem[]   // From generate_actionable_items tool
  scoreBreakdown: ScoreBreakdown      // From all 5 scoring tools
}
```

#### Backend Integration Points

The component expects data from these Strands tools:

1. **Risk Tools** (`backend/app/strands/tools/risk_tools.py`):
   - `calculate_risk_score` - EOSL Risk, security vulnerabilities, business criticality
   - `calculate_complexity_score` - Integration count, version gaps, application type
   - `calculate_migration_readiness_score` - Source code, CI/CD, target versions
   - `calculate_team_readiness_score` - Team availability, skills, training
   - `calculate_business_readiness_score` - Maintenance windows, stakeholder alignment
   - `calculate_final_priority` - Weighted combination of all scores
   - `identify_blockers` - Absolute blockers and warnings
   - `generate_actionable_items` - EOSL risks, CVEs, blockers with recommendations

2. **API Endpoints**:
   - `POST /api/v1/risk/assess` - Trigger assessment via Strands agent
   - `GET /api/v1/risk/assessments/{id}` - Get assessment results
   - `GET /api/v1/risk/actionable-items/{appId}` - Get actionable items

#### Usage

```tsx
import RiskSummaryTab from './RiskSummaryTab'

// With real data from API
<RiskSummaryTab 
  data={assessmentData} 
  loading={isAssessing} 
/>

// With mock data (for development)
<RiskSummaryTab />
```

#### Props

- `data?: RiskSummaryData` - Assessment data from Strands agents
- `loading?: boolean` - Loading state during assessment

#### Mock Data

The component includes comprehensive mock data for development and testing, demonstrating all features and data structures.

## Testing

Tests are located in `frontend/tests/components/risk/`:
- `RiskSummaryTab.test.tsx` - Component tests
- `RiskDashboard.test.tsx` - Dashboard integration tests

Run tests:
```bash
npm test -- RiskSummaryTab.test.tsx
```

## Future Enhancements

1. Real-time updates via WebSocket during assessment
2. Export functionality for actionable items
3. Historical trend visualization
4. Drill-down into individual score components
5. Comparison view for multiple applications
