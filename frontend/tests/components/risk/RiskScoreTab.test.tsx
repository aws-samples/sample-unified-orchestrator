import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RiskScoreTab from '../../../src/features/ara/components/risk/RiskScoreTab'

describe('RiskScoreTab', () => {
  it('shows no assessment data placeholder when no props provided', () => {
    render(<RiskScoreTab />)
    expect(screen.getByText('No Assessment Data')).toBeInTheDocument()
  })

  it('displays loading state when loading prop is true', () => {
    render(<RiskScoreTab loading={true} />)
    expect(screen.getByText('Loading risk score data...')).toBeInTheDocument()
  })

  it('renders score and factor labels with report data', () => {
    const reportData = {
      scores: { risk_score: 65 },
      risk_level: 'high',
      risk_assessment: {
        risk_score: 65,
        eosl_risk: 75,
        eosl_components: 3,
        vulnerability_risk: 50,
        business_criticality: 40,
        stability_risk: 30,
      },
      categories: {},
    }
    render(<RiskScoreTab reportData={reportData} />)

    expect(screen.getByText('Overall Risk Score')).toBeInTheDocument()
    expect(screen.getByText('65/100')).toBeInTheDocument()
    expect(screen.getByText('EOSL Risk (40% weight)')).toBeInTheDocument()
    expect(screen.getByText('Security Vulnerabilities (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('Business Criticality (20% weight)')).toBeInTheDocument()
    expect(screen.getByText('Current Stability (15% weight)')).toBeInTheDocument()
  })
})
