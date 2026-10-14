import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ComplexityTab from '../../../src/features/ara/components/risk/ComplexityTab'

describe('ComplexityTab', () => {
  it('shows no assessment data placeholder when no props provided', () => {
    render(<ComplexityTab />)
    expect(screen.getByText('No Assessment Data')).toBeInTheDocument()
  })

  it('displays loading state when loading prop is true', () => {
    render(<ComplexityTab loading={true} />)
    expect(screen.getByText('Loading complexity data...')).toBeInTheDocument()
  })

  it('renders score and factor labels with report data', () => {
    const reportData = {
      scores: { complexity_score: 45 },
      complexity: {
        metrics: {
          integration_score: 60,
          integration_count: 5,
          application_type_score: 25,
          testing_maturity: 'Unit Only',
          testing_maturity_score: 50,
          data_migration_size: '10 GB',
          data_migration_size_score: 30,
          machine_count: 3,
          machine_count_score: 40,
        },
      },
    }
    render(<ComplexityTab reportData={reportData} />)

    expect(screen.getByText('Overall Complexity Score')).toBeInTheDocument()
    expect(screen.getByText('45/100')).toBeInTheDocument()
    expect(screen.getByText('Integration Count (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('Application Type (15% weight)')).toBeInTheDocument()
    expect(screen.getByText('Testing Maturity (10% weight)')).toBeInTheDocument()
    expect(screen.getByText('Data Migration Size (10% weight)')).toBeInTheDocument()
    expect(screen.getByText('Machine Count (20% weight)')).toBeInTheDocument()
  })
})
