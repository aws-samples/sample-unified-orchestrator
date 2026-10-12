import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReadinessInputWizard from '../../../src/features/ara/components/risk/ReadinessInputWizard'

describe('ReadinessInputWizard', () => {
  const mockOnDismiss = vi.fn()
  const mockOnSubmit = vi.fn()
  const defaultProps = { visible: true, onDismiss: mockOnDismiss, onSubmit: mockOnSubmit }

  beforeEach(() => { vi.clearAllMocks() })

  it('renders wizard when visible is true', () => {
    render(<ReadinessInputWizard {...defaultProps} />)
    expect(screen.getByText('Application Readiness Assessment')).toBeInTheDocument()
  })

  it('does not render wizard when visible is false', () => {
    render(<ReadinessInputWizard {...defaultProps} visible={false} />)
    expect(screen.queryByText('Application Readiness Assessment')).not.toBeInTheDocument()
  })

  it('renders all three wizard steps', () => {
    render(<ReadinessInputWizard {...defaultProps} />)
    expect(screen.getAllByText('Team Readiness Input').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Business Readiness Input').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Review & Confirm').length).toBeGreaterThan(0)
  })

  it('renders team readiness dropdowns on step 1', () => {
    render(<ReadinessInputWizard {...defaultProps} />)
    expect(screen.getByText('Team Availability')).toBeInTheDocument()
    expect(screen.getByText('Skill Level')).toBeInTheDocument()
    expect(screen.getByText('Knowledge Transfer')).toBeInTheDocument()
    expect(screen.getByText('Training Completed')).toBeInTheDocument()
  })

  it('shows validation errors when trying to proceed without selections', () => {
    render(<ReadinessInputWizard {...defaultProps} />)
    const nextButton = screen.getByRole('button', { name: /next/i })
    fireEvent.click(nextButton)
    expect(screen.getByText(/Required fields missing/i)).toBeInTheDocument()
    expect(screen.getByText('Team availability is required')).toBeInTheDocument()
  })

  it('calls onDismiss when cancel is clicked', () => {
    render(<ReadinessInputWizard {...defaultProps} />)
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelButton)
    expect(mockOnDismiss).toHaveBeenCalledTimes(1)
  })
})
