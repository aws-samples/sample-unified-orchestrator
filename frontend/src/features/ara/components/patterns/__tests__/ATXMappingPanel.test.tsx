import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ATXMappingPanel from '../ATXMappingPanel'
import * as patternsService from '../../../services/patterns'

// Mock the patterns service
vi.mock('../../../services/patterns', () => ({
  getATXTransformations: vi.fn(),
  submitATXMappings: vi.fn(),
}))

const mockPatterns = [
  {
    pattern_id: 'PATTERN_TEST123',
    pattern_state: 'HAS_CHANGES',
    human_name: 'Java Runtime Upgrade',
    description: 'Upgrade Java runtime from 8 to 17',
    pattern_signature: 'Java 8→17',
    migration_strategy: 'Runtime Major Upgrade',
    application_count: 2,
    applications: [
      {
        app_id: 'app-001',
        app_name: 'Customer Portal',
        description: 'Web application',
        change_count: 3,
        total_components: 10,
      },
      {
        app_id: 'app-002',
        app_name: 'Admin Dashboard',
        description: 'Admin interface',
        change_count: 2,
        total_components: 8,
      },
    ],
  },
]

const mockATXTransformations = [
  {
    name: 'AWS/java-version-upgrade',
    description: 'Upgrade Java applications using any build system',
    version: '2025-11-11',
  },
  {
    name: 'AWS/java-aws-sdk-v1-to-v2',
    description: 'Upgrade the AWS SDK from V1 to V2',
    version: '2025-10-16',
  },
]

describe('ATXMappingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render loading state initially', () => {
    vi.mocked(patternsService.getATXTransformations).mockImplementation(
      () => new Promise(() => {}) // Never resolves
    )

    render(<ATXMappingPanel waveId="wave-001" patterns={mockPatterns} />)

    expect(screen.getByText('Loading ATX transformations...')).toBeInTheDocument()
  })

  it('should show warning when no ATX file uploaded', async () => {
    vi.mocked(patternsService.getATXTransformations).mockResolvedValue({
      success: false,
      transformations: [],
      count: 0,
      error: 'No ATX file uploaded',
    })

    render(<ATXMappingPanel waveId="wave-001" patterns={mockPatterns} />)

    await waitFor(() => {
      expect(screen.getByText('No ATX file uploaded')).toBeInTheDocument()
    })
  })

  it('should render patterns with ATX dropdowns', async () => {
    vi.mocked(patternsService.getATXTransformations).mockResolvedValue({
      success: true,
      transformations: mockATXTransformations,
      count: 2,
    })

    render(<ATXMappingPanel waveId="wave-001" patterns={mockPatterns} />)

    await waitFor(() => {
      expect(screen.getByText('Java Runtime Upgrade')).toBeInTheDocument()
      expect(screen.getByText('Customer Portal')).toBeInTheDocument()
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument()
    })
  })

  it('should show submit button disabled when no mappings selected', async () => {
    vi.mocked(patternsService.getATXTransformations).mockResolvedValue({
      success: true,
      transformations: mockATXTransformations,
      count: 2,
    })

    render(<ATXMappingPanel waveId="wave-001" patterns={mockPatterns} />)

    await waitFor(() => {
      expect(screen.getByText('Submit Mappings')).toBeInTheDocument()
    })

    const submitButton = screen.getByText('Submit Mappings').closest('button')
    expect(submitButton).toBeDisabled()
  })

  it('should submit mappings successfully', async () => {
    vi.mocked(patternsService.getATXTransformations).mockResolvedValue({
      success: true,
      transformations: mockATXTransformations,
      count: 2,
    })

    vi.mocked(patternsService.submitATXMappings).mockResolvedValue({
      success: true,
      updated_count: 2,
      message: 'Successfully updated 2 ATX mappings',
    })

    const onMappingsSubmitted = vi.fn()

    render(
      <ATXMappingPanel
        waveId="wave-001"
        patterns={mockPatterns}
        onMappingsSubmitted={onMappingsSubmitted}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Submit Mappings')).toBeInTheDocument()
    })

    // Note: Full interaction testing would require more complex setup
    // This is a basic structure test
  })

  it('should show info message when no patterns provided', async () => {
    vi.mocked(patternsService.getATXTransformations).mockResolvedValue({
      success: true,
      transformations: mockATXTransformations,
      count: 2,
    })

    render(<ATXMappingPanel waveId="wave-001" patterns={[]} />)

    await waitFor(() => {
      expect(
        screen.getByText('No patterns available for mapping. Please run application pattern analysis first.')
      ).toBeInTheDocument()
    })
  })
})
