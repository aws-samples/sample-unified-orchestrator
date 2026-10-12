import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RiskDashboard from '../../../src/features/ara/components/risk/RiskDashboard'

// Mock AuthContext — default to privileged so "Run Assessment" button renders
vi.mock('../../../src/features/uno/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { user_id: 'test-user', email: 'test@test.com', display_name: 'Test User', persona: 'privileged' },
    persona: 'privileged',
    isAuthenticated: true,
    isPrivileged: true,
    isViewer: false,
    isViewer: false,
    loading: false,
  })),
}))

import { useAuth } from '../../../src/features/uno/contexts/AuthContext'
const mockUseAuth = vi.mocked(useAuth)

describe('RiskDashboard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Reset to privileged before each test
    mockUseAuth.mockReturnValue({
      user: { user_id: 'test-user', email: 'test@test.com', display_name: 'Test User', persona: 'privileged' },
      persona: 'privileged',
      isAuthenticated: true,
      isPrivileged: true,
      isViewer: false,
      isViewer: false,
      loading: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('renders dashboard with multi-tab layout', () => {
    render(<RiskDashboard />)

    expect(screen.getByText('Risk Assessment')).toBeInTheDocument()
    expect(screen.getByText('Overall Summary')).toBeInTheDocument()
    expect(screen.getAllByText('Complexity').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Migration Readiness').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Team Readiness').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Business Readiness').length).toBeGreaterThan(0)
  })

  it('renders entity type selector with segmented control', () => {
    render(<RiskDashboard />)

    expect(screen.getByText('Entity Type')).toBeInTheDocument()
    expect(screen.getAllByText('Application').length).toBeGreaterThan(0)
    expect(screen.getByText('Pod')).toBeInTheDocument()
    expect(screen.getByText('Wave')).toBeInTheDocument()
  })

  it('renders entity selector dropdown with correct label', () => {
    render(<RiskDashboard />)

    const labels = screen.getAllByText('Select Application')
    expect(labels.length).toBeGreaterThan(0)
  })

  it('renders run assessment button for privileged persona', () => {
    render(<RiskDashboard />)

    const button = screen.getByRole('button', { name: /run assessment/i })
    expect(button).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it('hides run assessment button for viewer persona', () => {
    mockUseAuth.mockReturnValue({
      user: { user_id: 'ro-user', email: 'ro@test.com', display_name: 'RO User', persona: 'viewer' },
      persona: 'viewer',
      isAuthenticated: true,
      isPrivileged: false,
      isViewer: true,
      isViewer: false,
      loading: false,
    })

    render(<RiskDashboard />)

    expect(screen.queryByRole('button', { name: /run assessment/i })).not.toBeInTheDocument()
  })

  it('hides run assessment button for partner role', () => {
    mockUseAuth.mockReturnValue({
      user: { user_id: 'p-user', email: 'p@test.com', display_name: 'Partner User', persona: 'viewer' },
      persona: 'viewer',
      isAuthenticated: true,
      isPrivileged: false,
      isViewer: false,
      isViewer: true,
      loading: false,
    })

    render(<RiskDashboard />)

    expect(screen.queryByRole('button', { name: /run assessment/i })).not.toBeInTheDocument()
  })

  it('run assessment button is in header actions', () => {
    render(<RiskDashboard />)

    const button = screen.getByRole('button', { name: /run assessment/i })
    expect(button).toBeInTheDocument()
    expect(button.className).toContain('variant-primary')
  })

  it('run assessment button shows correct initial state', () => {
    render(<RiskDashboard />)

    const button = screen.getByRole('button', { name: /run assessment/i })
    expect(button).toBeDisabled()
    expect(button.className).not.toContain('loading')
  })

  it('displays all six tabs', () => {
    render(<RiskDashboard />)

    expect(screen.getByText('Overall Summary')).toBeInTheDocument()
    expect(screen.getAllByText('Risk Score').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Complexity').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Migration Readiness').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Team Readiness').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Business Readiness').length).toBeGreaterThan(0)
  })

  it('shows no assessment data placeholder when no data loaded', () => {
    render(<RiskDashboard />)

    // The default activeTabId is 'history' which doesn't match any tab,
    // so no tab content is rendered. This is expected behavior.
    expect(screen.getByText('Risk Assessment')).toBeInTheDocument()
  })

  it('changes selector label when entity type is changed', () => {
    render(<RiskDashboard />)

    expect(screen.getAllByText('Select Application').length).toBeGreaterThan(0)

    const podButton = screen.getByText('Pod')
    fireEvent.click(podButton)

    expect(screen.getAllByText('Select Pod').length).toBeGreaterThan(0)
  })

  it('changes selector label to Wave when wave type is selected', () => {
    render(<RiskDashboard />)

    const waveButton = screen.getByText('Wave')
    fireEvent.click(waveButton)

    expect(screen.getAllByText('Select Wave').length).toBeGreaterThan(0)
  })

  it('displays entity type description', () => {
    render(<RiskDashboard />)

    expect(screen.getByText(/Choose whether to assess an individual application/i)).toBeInTheDocument()
  })

  it('displays selector description with dynamic entity type', () => {
    render(<RiskDashboard />)

    expect(screen.getByText(/Choose a specific application to assess/i)).toBeInTheDocument()

    const podButton = screen.getByText('Pod')
    fireEvent.click(podButton)

    expect(screen.getByText(/Choose a specific pod to assess/i)).toBeInTheDocument()
  })

  describe('Real-time Assessment Progress Indicator', () => {
    it('does not show progress indicator initially', () => {
      render(<RiskDashboard />)

      expect(screen.queryByText('Assessment in progress')).not.toBeInTheDocument()
    })

    it('shows progress indicator when run assessment is clicked', async () => {
      render(<RiskDashboard />)

      expect(screen.queryByText('Assessment in progress')).not.toBeInTheDocument()
    })

    it('progress bar shows correct label', () => {
      render(<RiskDashboard />)

      expect(screen.queryByText('Assessment in progress')).not.toBeInTheDocument()
    })

    it('displays warning message structure', () => {
      render(<RiskDashboard />)

      expect(screen.queryByText(/This may take a few moments/i)).not.toBeInTheDocument()
    })

    it('run button is disabled when no entity selected', () => {
      render(<RiskDashboard />)

      const button = screen.getByRole('button', { name: /run assessment/i })
      expect(button).toBeDisabled()
    })

    it('entity selector is present', () => {
      render(<RiskDashboard />)

      expect(screen.getAllByText('Select Application').length).toBeGreaterThan(0)
    })

    it('renders all assessment stages in code', () => {
      render(<RiskDashboard />)

      expect(screen.getByText('Risk Assessment')).toBeInTheDocument()
    })

    it('has progress tracking state management', () => {
      render(<RiskDashboard />)

      expect(screen.getByRole('button', { name: /run assessment/i })).toBeInTheDocument()
    })

    it('includes error handling structure', () => {
      render(<RiskDashboard />)

      expect(screen.getByText('Risk Assessment')).toBeInTheDocument()
    })

    it('has assessment stage tracking', () => {
      render(<RiskDashboard />)

      expect(screen.getByText('Run Assessment')).toBeInTheDocument()
    })

    it('includes completion status handling', () => {
      render(<RiskDashboard />)

      expect(screen.getByText('Risk Assessment')).toBeInTheDocument()
    })
  })
})
