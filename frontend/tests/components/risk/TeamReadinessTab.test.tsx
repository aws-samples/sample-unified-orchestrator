import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TeamReadinessTab from '../../../src/features/ara/components/risk/TeamReadinessTab'

describe('TeamReadinessTab', () => {
  it('shows no assessment data placeholder when no props provided', () => {
    render(<TeamReadinessTab />)
    expect(screen.getByText('No Assessment Data')).toBeInTheDocument()
  })

  it('displays loading state when loading prop is true', () => {
    render(<TeamReadinessTab loading={true} />)
    expect(screen.getByText('Loading team readiness data...')).toBeInTheDocument()
  })

  it('renders score and factor labels with report data', () => {
    const reportData = {
      scores: { team_readiness_score: 72 },
      team_readiness: {
        inputs: { team_availability: 'Dedicated', skill_level: 'Expert', knowledge_transfer: 'Full docs + devs', training_completed: 'All trained' },
        details: { factors: { team_availability: 100, skill_level: 100, knowledge_transfer: 100, training_completed: 100 } },
      },
    }
    render(<TeamReadinessTab reportData={reportData} />)

    expect(screen.getByText('Overall Team Readiness Score')).toBeInTheDocument()
    expect(screen.getByText('72/100')).toBeInTheDocument()
    expect(screen.getByText('Team Availability (30% weight)')).toBeInTheDocument()
    expect(screen.getByText('Skill Level (30% weight)')).toBeInTheDocument()
    expect(screen.getByText('Knowledge Transfer (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('Training Completed (15% weight)')).toBeInTheDocument()
  })
})
