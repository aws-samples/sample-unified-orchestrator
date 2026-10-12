import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box } from '@cloudscape-design/components'
import { useAuth } from '../contexts/AuthContext'
import { isDevMode } from '../services/auth'
import { login as pkceLogin, isAuthenticated as pkceIsAuthenticated } from '../services/pkceAuth'

export default function LoginPage() {
    const { isAuthenticated, loading } = useAuth()
    const navigate = useNavigate()

    useEffect(() => {
        if (!loading && isAuthenticated) {
            navigate('/', { replace: true })
            return
        }

        if (isDevMode()) {
            navigate('/', { replace: true })
            return
        }

        // If we have valid tokens but AuthContext hasn't loaded yet, wait
        if (pkceIsAuthenticated()) {
            return
        }

        // No valid tokens — redirect to PKCE login
        pkceLogin()
    }, [isAuthenticated, loading, navigate])

    return (
        <Box textAlign="center" padding={{ top: 'xxxl' }}>
            <Box variant="p" color="text-body-secondary">Redirecting to login...</Box>
        </Box>
    )
}
