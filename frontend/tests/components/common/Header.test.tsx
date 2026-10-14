import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Header from '../../../src/features/uno/components/common/Header'

describe('Header', () => {
  it('renders title', () => {
    render(<Header title="Test Title" />)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
  })

  it('renders description when provided', () => {
    render(<Header title="Test Title" description="Test Description" />)
    expect(screen.getByText('Test Description')).toBeInTheDocument()
  })
})
