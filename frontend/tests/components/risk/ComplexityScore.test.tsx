import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ComplexityScore from '../../../src/features/ara/components/risk/ComplexityScore'

describe('ComplexityScore', () => {
  it('renders the component', () => {
    render(<ComplexityScore />)

    expect(screen.getByText('Complexity Score')).toBeInTheDocument()
  })

  it('displays placeholder message', () => {
    render(<ComplexityScore />)

    expect(screen.getByText(/Complexity score component will be implemented in a future task/i)).toBeInTheDocument()
  })

  it('renders without errors', () => {
    const { container } = render(<ComplexityScore />)

    expect(container).toBeInTheDocument()
  })
})
