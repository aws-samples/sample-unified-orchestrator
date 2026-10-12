import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RiskSummaryTab from '../../../src/features/ara/components/risk/RiskSummaryTab'

describe('RiskSummaryTab', () => {
  it('shows no assessment data placeholder when no props provided', () => {
    render(<RiskSummaryTab />)
    expect(screen.getByText('No Assessment Data')).toBeInTheDocument()
  })

  it('renders overall score and score summary with report data', () => {
    const reportData = {
      overall_score: 75,
      scores: {
        risk_score: 65,
        complexity_score: 72,
        migration_readiness_score: 58,
        team_readiness_score: 85,
        business_readiness_score: 90,
      },
      actionable_items: [
        { id: '1', type: 'eosl', severity: 'critical', title: 'Java 8 End of Life', description: 'Java 8 reaches end of support', recommendation: 'Upgrade to Java 17' },
      ],
    }
    render(<RiskSummaryTab reportData={reportData} />)

    expect(screen.getByText('Overall Application Readiness Score')).toBeInTheDocument()
    expect(screen.getByText('75/100')).toBeInTheDocument()
    expect(screen.getByText('Score Summary')).toBeInTheDocument()
    expect(screen.getByText('Actionable Items')).toBeInTheDocument()
    expect(screen.getByText('Java 8 End of Life')).toBeInTheDocument()
  })
})
