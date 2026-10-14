import { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Box, Button, SpaceBetween, Icon } from '@cloudscape-design/components'
import { useAuth } from '../../contexts/AuthContext'
import { isDevMode } from '../../services/auth'

interface ProtectedRouteProps {
    children: ReactNode
}

/**
 * Wraps routes that require authentication.
 * - Dev mode: always renders children (backend handles mock auth)
 * - Production: shows access denied if 403, redirects to /login if not authenticated
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { isAuthenticated, accessDenied, accessDeniedReason, loading, logout } = useAuth()

    // Dev mode bypasses auth check
    if (isDevMode()) {
        return <>{children}</>
    }

    if (loading) {
        return (
            <Box textAlign="center" padding={{ top: 'xxxl' }}>
                <Box variant="p" color="text-body-secondary">Loading...</Box>
            </Box>
        )
    }

    if (accessDenied) {
        return (
            <Box textAlign="center" padding={{ top: 'xxxl' }}>
                <SpaceBetween size="l" alignItems="center">
                    <Icon name="status-warning" size="big" variant="warning" />
                    <Box variant="h1">Access Denied</Box>
                    <Box variant="p" color="text-body-secondary">
                        {accessDeniedReason || 'Your account does not have the required permissions to access this platform.'}
                    </Box>
                    <Box variant="p" color="text-body-secondary" fontSize="body-s">
                        Contact your administrator to request the appropriate group membership.
                    </Box>
                    <Button onClick={logout}>Sign out</Button>
                </SpaceBetween>
            </Box>
        )
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />
    }

    return <>{children}</>
}
