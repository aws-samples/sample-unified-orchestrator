import { Box, Spinner } from '@cloudscape-design/components'

/**
 * OAuth callback page.
 *
 * This is a placeholder — the actual token exchange is handled by
 * AuthContext.initAuth() which detects the /callback path and code
 * parameter, exchanges the code for tokens, then redirects to /.
 *
 * If the verifier is missing (e.g. sessionStorage was cleared),
 * AuthContext restarts the PKCE login flow automatically.
 */
export default function CallbackPage() {
    return (
        <Box textAlign="center" padding={{ top: 'xxxl' }}>
            <Spinner size="large" />
            <Box variant="p" color="text-body-secondary" margin={{ top: 's' }}>
                Completing sign-in...
            </Box>
        </Box>
    )
}
