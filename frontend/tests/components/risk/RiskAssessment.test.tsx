import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RiskAssessment from '../../../src/features/ara/components/risk/RiskAssessment'

describe('RiskAssessment', () => {
  it('renders the component', () => {
    render(<RiskAssessment />)

    expect(screen.getByText('Risk Assessment')).toBeInTheDocument()
  })

  it('displays placeholder message', () => {
    render(<RiskAssessment />)

    expect(screen.getByText(/Risk assessment component will be implemented in a future task/i)).toBeInTheDocument()
  })

  it('renders without errors', () => {
    const { container } = render(<RiskAssessment />)

    expect(container).toBeInTheDocument()
  })
})
