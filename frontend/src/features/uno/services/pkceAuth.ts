/**
 * PKCE OAuth service for CCoE-compliant authentication.
 *
 * Implements the full PKCE flow: authorize → callback → token exchange → storage.
 * All auth traffic routes through the NGINX auth proxy subdomain.
 * Tokens are stored in sessionStorage only (never localStorage).
 */

import authConfig, { getAuthEndpoint } from './authConfig'

// ── SessionStorage keys ──────────────────────────────────────────────
const VERIFIER_KEY = 'pkce_code_verifier'
const ACCESS_TOKEN_KEY = 'access_token'
const ID_TOKEN_KEY = 'id_token'
const REFRESH_TOKEN_KEY = 'refresh_token'
const EXPIRES_AT_KEY = 'token_expires_at'

// ── PKCE helpers (2.2) ──────────────────────────────────────────────

/** Generate a cryptographically random code verifier (43–128 chars, base64url). */
export function generateCodeVerifier(): string {
    const array = new Uint8Array(32)
    crypto.getRandomValues(array)
    return base64UrlEncode(array)
}

/** Compute SHA-256 code challenge from a verifier (base64url-encoded). */
export async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const digest = await crypto.subtle.digest('SHA-256', data)
    return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(buffer: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < buffer.length; i++) {
        binary += String.fromCharCode(buffer[i])
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ── Login (2.3) ─────────────────────────────────────────────────────

/** Initiate PKCE login: generate verifier/challenge, redirect to authorize endpoint. */
export async function login(): Promise<void> {
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    // Store verifier in BOTH localStorage and sessionStorage for resilience.
    // Some browsers/contexts lose sessionStorage across redirects.
    localStorage.setItem(VERIFIER_KEY, verifier)
    sessionStorage.setItem(VERIFIER_KEY, verifier)

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: authConfig.clientId,
        redirect_uri: authConfig.redirectUri,
        scope: authConfig.scope,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    })

    window.location.href = getAuthEndpoint(`/oauth2/authorize?${params.toString()}`)
}

// ── Callback / Token Exchange (2.4) ─────────────────────────────────

/** Exchange authorization code for tokens using the stored PKCE verifier. */
export async function handleCallback(code: string): Promise<void> {
    // Try sessionStorage first, fall back to localStorage
    const verifier = sessionStorage.getItem(VERIFIER_KEY) || localStorage.getItem(VERIFIER_KEY)
    if (!verifier) {
        throw new Error('PKCE code verifier not found in storage')
    }

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: authConfig.clientId,
        redirect_uri: authConfig.redirectUri,
        code,
        code_verifier: verifier,
    })

    const response = await fetch(getAuthEndpoint('/oauth2/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`)
    }

    const tokenResponse = await response.json()
    storeTokens(tokenResponse)

    // Clean up the verifier — no longer needed
    sessionStorage.removeItem(VERIFIER_KEY)
    localStorage.removeItem(VERIFIER_KEY)
}

// ── Token Storage (2.5) ─────────────────────────────────────────────

interface TokenResponse {
    access_token: string
    id_token: string
    refresh_token?: string
    expires_in: number
}

/** Save tokens and computed expiry to sessionStorage. */
export function storeTokens(response: TokenResponse): void {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, response.access_token)
    sessionStorage.setItem(ID_TOKEN_KEY, response.id_token)
    if (response.refresh_token) {
        sessionStorage.setItem(REFRESH_TOKEN_KEY, response.refresh_token)
    }
    const expiresAt = new Date(Date.now() + response.expires_in * 1000).toISOString()
    sessionStorage.setItem(EXPIRES_AT_KEY, expiresAt)
}

// ── Token Accessors (2.6) ───────────────────────────────────────────

/** Return the access token if it exists and hasn't expired, else null. */
export function getAccessToken(): string | null {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY)
    const expiresAt = sessionStorage.getItem(EXPIRES_AT_KEY)
    if (!token || !expiresAt) return null
    if (new Date(expiresAt) <= new Date()) return null
    return token
}

/** Return the id token from sessionStorage. */
export function getIdToken(): string | null {
    return sessionStorage.getItem(ID_TOKEN_KEY)
}

/** Check whether a valid (non-expired) access token exists. */
export function isAuthenticated(): boolean {
    return getAccessToken() !== null
}

// ── Logout / Clear (2.7) ────────────────────────────────────────────

/** Remove all auth-related keys from sessionStorage. */
export function clearTokens(): void {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    sessionStorage.removeItem(ID_TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
    sessionStorage.removeItem(EXPIRES_AT_KEY)
    // NOTE: Do NOT remove VERIFIER_KEY here — it may be needed by an
    // in-flight PKCE callback. The verifier is cleaned up after a
    // successful token exchange in handleCallback().
}

/** Clear tokens and redirect to the Cognito logout endpoint via the auth proxy. */
export function logout(): void {
    clearTokens()
    sessionStorage.removeItem(VERIFIER_KEY)
    localStorage.removeItem(VERIFIER_KEY)

    const params = new URLSearchParams({
        client_id: authConfig.clientId,
        logout_uri: authConfig.logoutUri,
    })

    window.location.href = getAuthEndpoint(`/logout?${params.toString()}`)
}

// ── Token Parsing / User Info (2.8) ─────────────────────────────────

/** Base64-decode a JWT payload (middle segment). */
export function parseToken(token: string): Record<string, unknown> {
    const parts = token.split('.')
    if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
    }
    const payload = parts[1]
    // Restore base64 padding and standard chars
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(base64)
    return JSON.parse(json)
}

export interface UserInfo {
    sub: string
    email: string
    username: string
    groups: string[]
}

/** Extract user claims from the stored id_token. */
export function getUserInfo(): UserInfo | null {
    const idToken = getIdToken()
    if (!idToken) return null

    try {
        const claims = parseToken(idToken)
        return {
            sub: (claims.sub as string) || '',
            email: (claims.email as string) || '',
            username: (claims['cognito:username'] as string) || (claims.username as string) || '',
            groups: (claims['cognito:groups'] as string[]) || [],
        }
    } catch {
        return null
    }
}
