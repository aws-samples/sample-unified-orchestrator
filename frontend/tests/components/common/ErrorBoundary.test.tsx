import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../../../src/features/uno/components/common/ErrorBoundary'

const ThrowError = () => {
  throw new Error('Test error')
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Test Content</div>
      </ErrorBoundary>
    )

    expect(screen.getByText('Test Content')).toBeInTheDocument()
  })

  it('renders error message when child component throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    )

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
  })
})
