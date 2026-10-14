import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import AppRoutes from '../../src/routes'

// Mock AuthContext so ProtectedRoute lets us through
vi.mock('../../src/features/uno/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { user_id: 'test-user', email: 'test@test.com', display_name: 'Test User', persona: 'privileged' },
    persona: 'privileged',
    isAuthenticated: true,
    isPrivileged: true,
    isViewer: false,
    loading: false,
  })),
}))

describe('AppRoutes', () => {
  it('renders not found page on invalid path', () => {
    render(
      <MemoryRouter initialEntries={['/invalid-path']}>
        <AppRoutes />
      </MemoryRouter>
    )
    expect(screen.getByText(/Page Not Found/i)).toBeInTheDocument()
  })
})
