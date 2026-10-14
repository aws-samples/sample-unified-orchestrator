import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BusinessReadinessTab from '../../../src/features/ara/components/risk/BusinessReadinessTab'

describe('BusinessReadinessTab', () => {
  it('shows no assessment data placeholder when no props provided', () => {
    render(<BusinessReadinessTab />)
    expect(screen.getByText('No Assessment Data')).toBeInTheDocument()
  })

  it('displays loading state when loading prop is true', () => {
    render(<BusinessReadinessTab loading={true} />)
    expect(screen.getByText('Loading business readiness data...')).toBeInTheDocument()
  })

  it('renders score and factor labels with report data', () => {
    const reportData = {
      scores: { business_readiness_score: 75 },
      business_readiness: {
        inputs: { maintenance_window: 'Flexible', business_calendar: 'Off-peak', stakeholder_alignment: 'Full buy-in', budget_availability: 'Fully funded' },
        details: { factors: { maintenance_window: 100, business_calendar: 100, stakeholder_alignment: 100, budget_availability: 100 } },
      },
    }
    render(<BusinessReadinessTab reportData={reportData} />)

    expect(screen.getByText('Overall Business Readiness Score')).toBeInTheDocument()
    expect(screen.getByText('75/100')).toBeInTheDocument()
    expect(screen.getByText('Maintenance Window (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('Business Calendar (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('Stakeholder Alignment (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('Budget Availability (25% weight)')).toBeInTheDocument()
  })
})
