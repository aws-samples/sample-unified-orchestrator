import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import MainLayout from '../../../src/features/uno/components/common/MainLayout'
import { ThemeProvider } from '../../../src/features/uno/contexts/ThemeContext'
import { AuthProvider } from '../../../src/features/uno/contexts/AuthContext'

describe('MainLayout', () => {
  it('renders the layout with navigation', () => {
    render(
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <MainLayout>
              <div>Test Content</div>
            </MainLayout>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    )

    expect(screen.getAllByText('Unified Orchestrator').length).toBeGreaterThan(0)
    expect(screen.getByText('Test Content')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })
})
