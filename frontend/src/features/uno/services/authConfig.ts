/**
 * OAuth configuration for CCoE-compliant PKCE flow.
 *
 * All auth traffic routes through the NGINX auth proxy subdomain —
 * the frontend never talks directly to Cognito endpoints.
 *
 * Values come from Vite env vars with sensible defaults for the
 * deployed environment.
 */

export interface AuthConfig {
    authDomain: string
    clientId: string
    redirectUri: string
    logoutUri: string
    scope: string
}

const authConfig: AuthConfig = {
    authDomain: import.meta.env.VITE_AUTH_DOMAIN || '',
    clientId: import.meta.env.VITE_CLIENT_ID || '',
    redirectUri: import.meta.env.VITE_REDIRECT_URI || `${window.location.origin}/callback`,
    logoutUri: import.meta.env.VITE_LOGOUT_URI || window.location.origin,
    scope: import.meta.env.VITE_OAUTH_SCOPE || 'openid profile email',
}

/**
 * Build an auth endpoint URL from the configured auth domain, rejecting anything
 * that is not a well-formed HTTPS origin (SSRF / misconfiguration guard).
 *
 * @param pathAndQuery - endpoint path plus optional query, e.g. `/oauth2/token`
 */
export function getAuthEndpoint(pathAndQuery: string): string {
    const domain = authConfig.authDomain
    if (!domain) {
        throw new Error('Auth domain is not configured (VITE_AUTH_DOMAIN)')
    }
    let parsed: URL
    try {
        parsed = new URL(domain)
    } catch {
        throw new Error(`Invalid auth domain (must be an absolute https URL): ${domain}`)
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Auth domain must use https: ${domain}`)
    }
    // Resolve the endpoint against the validated origin so only the auth host is contacted.
    return new URL(pathAndQuery, parsed.origin).toString()
}

export default authConfig
