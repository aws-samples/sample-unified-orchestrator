import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MigrationReadinessTab from '../../../src/features/ara/components/risk/MigrationReadinessTab'

describe('MigrationReadinessTab', () => {
  it('shows no assessment data placeholder when no props provided', () => {
    render(<MigrationReadinessTab />)
    expect(screen.getByText('No Assessment Data')).toBeInTheDocument()
  })

  it('displays loading state when loading prop is true', () => {
    render(<MigrationReadinessTab loading={true} />)
    expect(screen.getByText('Loading migration readiness data...')).toBeInTheDocument()
  })

  it('renders score and factor labels with report data', () => {
    const reportData = {
      scores: { migration_readiness_score: 68 },
      migration_readiness: {
        readiness_score: 68,
        factors: {
          source_code_available: true,
          source_code_score: 100,
          cicd_score: 80,
          cicd_maturity: 'Automated CI/CD',
          target_version_score: 75,
          target_version_coverage: 75,
          documentation_score: 70,
          documentation_quality: 'Good',
          monitoring_score: 50,
          monitoring_maturity: 'Basic',
          coverage_score: 65,
          code_coverage: 65,
        },
      },
      categories: {},
    }
    render(<MigrationReadinessTab reportData={reportData} />)

    expect(screen.getByText('Overall Migration Readiness Score')).toBeInTheDocument()
    expect(screen.getByText('68/100')).toBeInTheDocument()
    expect(screen.getByText('Source Code Availability (25% weight)')).toBeInTheDocument()
    expect(screen.getByText('CI/CD Maturity (20% weight)')).toBeInTheDocument()
    expect(screen.getByText('Target Version Availability (20% weight)')).toBeInTheDocument()
    expect(screen.getByText('Documentation Quality (15% weight)')).toBeInTheDocument()
    expect(screen.getByText('Monitoring Maturity (10% weight)')).toBeInTheDocument()
    expect(screen.getByText('Code Coverage (10% weight)')).toBeInTheDocument()
  })
})
