import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../AuthContext'

vi.mock('../../services/api', () => ({
    default: { get: vi.fn() },
}))

vi.mock('../../services/auth', () => ({
    isDevMode: vi.fn(() => true),
    logout: vi.fn(),
}))

import apiClient from '../../services/api'
import { isDevMode } from '../../services/auth'

const mockGet = vi.mocked(apiClient.get)
const mockIsDevMode = vi.mocked(isDevMode)

function TestConsumer() {
    const auth = useAuth()
    return (
        <div>
            <span data-testid="persona">{auth.persona ?? 'null'}</span>
            <span data-testid="isPrivileged">{String(auth.isPrivileged)}</span>
            <span data-testid="isViewer">{String(auth.isViewer)}</span>
            <span data-testid="isAuthenticated">{String(auth.isAuthenticated)}</span>
            <span data-testid="loading">{String(auth.loading)}</span>
            <span data-testid="displayName">{auth.user?.display_name ?? 'null'}</span>
        </div>
    )
}

function renderWithAuth() {
    return render(
        <AuthProvider>
            <TestConsumer />
        </AuthProvider>
    )
}

describe('AuthContext', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockIsDevMode.mockReturnValue(true)
    })

    it('sets isPrivileged=true for privileged persona', async () => {
        mockGet.mockResolvedValueOnce({
            data: { user_id: 'u1', email: 'a@b.com', display_name: 'Admin', persona: 'privileged' },
        } as any)

        renderWithAuth()

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('persona').textContent).toBe('privileged')
        expect(screen.getByTestId('isPrivileged').textContent).toBe('true')
        expect(screen.getByTestId('isViewer').textContent).toBe('false')
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('true')
    })

    it('sets isViewer=true for viewer persona', async () => {
        mockGet.mockResolvedValueOnce({
            data: { user_id: 'u2', email: 'r@b.com', display_name: 'Viewer', persona: 'viewer' },
        } as any)

        renderWithAuth()

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('persona').textContent).toBe('viewer')
        expect(screen.getByTestId('isViewer').textContent).toBe('true')
        expect(screen.getByTestId('isPrivileged').textContent).toBe('false')
    })

    it('handles auth endpoint failure gracefully', async () => {
        mockGet.mockRejectedValueOnce(new Error('Network error'))

        renderWithAuth()

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('persona').textContent).toBe('null')
        expect(screen.getByTestId('isAuthenticated').textContent).toBe('false')
        expect(screen.getByTestId('isPrivileged').textContent).toBe('false')
    })

    it('shows loading=true initially', () => {
        mockGet.mockReturnValueOnce(new Promise(() => { }) as any)
        renderWithAuth()
        expect(screen.getByTestId('loading').textContent).toBe('true')
    })

    it('exposes display_name from backend', async () => {
        mockGet.mockResolvedValueOnce({
            data: { user_id: 'u1', email: 'a@b.com', display_name: 'Dev User (privileged)', persona: 'privileged' },
        } as any)

        renderWithAuth()

        await waitFor(() => {
            expect(screen.getByTestId('loading').textContent).toBe('false')
        })

        expect(screen.getByTestId('displayName').textContent).toBe('Dev User (privileged)')
    })
})
