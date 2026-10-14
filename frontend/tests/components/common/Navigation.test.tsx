import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Navigation from '../../../src/features/uno/components/common/Navigation'

describe('Navigation', () => {
  it('renders navigation items', () => {
    render(
      <BrowserRouter>
        <Navigation />
      </BrowserRouter>
    )

    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getAllByText('Risk Assessment').length).toBeGreaterThan(0)
    expect(screen.getByText('Application Pattern')).toBeInTheDocument()
  })
})
