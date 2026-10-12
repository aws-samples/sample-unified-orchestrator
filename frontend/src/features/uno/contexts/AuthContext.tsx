import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import apiClient from '../services/api'
import { isDevMode } from '../services/auth'
import {
  isAuthenticated as pkceIsAuthenticated,
  handleCallback,
  login as pkceLogin,
  logout as pkceLogout,
} from '../services/pkceAuth'

type Persona = 'privileged' | 'viewer' | 'ADMIN' | 'PAM' | 'PROSERVE' | 'ATT' | 'PARTNERS'

// Personas that grant full (privileged-level) access
const PRIVILEGED_PERSONAS: Set<string> = new Set(['privileged', 'ADMIN', 'PROSERVE', 'ATT'])

interface User {
  user_id: string
  email: string
  display_name: string
  persona: Persona
  groups: string[]
}

interface AuthContextType {
  user: User | null
  persona: Persona | null
  groups: string[]
  isAuthenticated: boolean
  isPrivileged: boolean
  isViewer: boolean
  accessDenied: boolean
  accessDeniedReason: string
  loading: boolean
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessDeniedReason, setAccessDeniedReason] = useState('')

  useEffect(() => {
    const initAuth = async () => {
      // Dev mode: backend returns mock user
      if (isDevMode()) {
        try {
          const res = await apiClient.get('/config/auth')
          setUser(res.data)
        } catch {
          setUser(null)
        }
        setLoading(false)
        return
      }

      // Handle OAuth callback — AuthContext is the single handler
      const urlParams = new URLSearchParams(window.location.search)
      const code = urlParams.get('code')

      if (code && window.location.pathname === '/callback') {
        try {
          await handleCallback(code)
          // Tokens stored — redirect to root with full reload
          window.location.href = '/'
          return
        } catch (err) {
          console.warn('Token exchange failed:', err)
          // If this is already a retry, stop looping — show the app (will be unauthenticated)
          const retryKey = 'pkce_callback_retry'
          if (sessionStorage.getItem(retryKey)) {
            sessionStorage.removeItem(retryKey)
            console.error('PKCE callback failed after retry, giving up')
            setLoading(false)
            return
          }
          // Mark that we're retrying, then restart login
          sessionStorage.setItem(retryKey, '1')
          await pkceLogin()
          return
        }
      }

      // Check if authenticated
      if (!pkceIsAuthenticated()) {
        setLoading(false)
        await pkceLogin()
        return
      }

      // We have valid tokens — call backend to get user info
      try {
        const res = await apiClient.get('/config/auth')
        setUser(res.data)
      } catch (err: unknown) {
        console.error('AuthContext: /config/auth failed:', err)
        const axiosErr = err as { response?: { status?: number } }
        if (axiosErr.response?.status === 401) {
          // Token invalid — redirect to login
          await pkceLogin()
          return
        }
        if (axiosErr.response?.status === 403) {
          // Authenticated but not authorized (missing platform access)
          const detail = (err as { response?: { data?: { detail?: string } } })
            ?.response?.data?.detail || ''
          setAccessDenied(true)
          setAccessDeniedReason(detail)
          setUser(null)
          setLoading(false)
          return
        }
        setUser(null)
      }
      setLoading(false)
    }

    initAuth()
  }, [])

  const handleLogout = useCallback(() => {
    setUser(null)
    setAccessDenied(false)
    setAccessDeniedReason('')
    if (isDevMode()) {
      window.location.href = '/'
      return
    }
    pkceLogout()
  }, [])

  const persona = user?.persona ?? null

  return (
    <AuthContext.Provider
      value={{
        user,
        persona,
        groups: user?.groups ?? [],
        isAuthenticated: !!user,
        isPrivileged: persona !== null && PRIVILEGED_PERSONAS.has(persona),
        isViewer: persona !== null && !PRIVILEGED_PERSONAS.has(persona),
        accessDenied,
        accessDeniedReason,
        loading,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
