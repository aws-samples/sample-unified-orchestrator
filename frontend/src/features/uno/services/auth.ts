/**
 * Auth utilities.
 *
 * Authentication is handled by the CCoE-compliant PKCE OAuth flow.
 * The pkceAuth service manages tokens in sessionStorage and routes
 * all auth traffic through the NGINX auth proxy subdomain.
 *
 * In dev mode (VITE_AUTH_MODE=dev), auth is bypassed — the backend handles
 * mock user injection via DEV_PERSONA env var.
 */

import { logout as pkceLogout, isAuthenticated as pkceIsAuthenticated } from './pkceAuth'

export function isDevMode(): boolean {
  return import.meta.env.VITE_AUTH_MODE === 'dev'
}

/**
 * Sign the user out via PKCE logout.
 *
 * Clears sessionStorage tokens and redirects to the Cognito logout
 * endpoint through the NGINX auth proxy.
 */
export function logout(): void {
  if (isDevMode()) {
    window.location.href = '/'
    return
  }
  pkceLogout()
}

/** Check whether the user has a valid (non-expired) access token. */
export function isAuthenticated(): boolean {
  if (isDevMode()) return true
  return pkceIsAuthenticated()
}
