interface RequestOptions {
  method?: string
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  backend?: 'migration-refinery' | 'unified-orchestrator'
}

/**
 * Dual API client that can route requests to either the migration-refinery backend
 * or the unified orchestrator backend based on configuration.
 *
 * @param path - The API endpoint path
 * @param options - Request options including backend selection, method, body, and params
 * @returns Promise resolving to the API response
 */
/**
 * Reject any path that could escape the current origin (SSRF / open-redirect guard).
 * Only same-origin, absolute-from-root API paths are permitted — no scheme, no host,
 * and no protocol-relative ("//host") or backslash-normalized ("/\\host") forms.
 */
function assertSafeApiPath(path: string): void {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`Invalid API path (must be an absolute same-origin path): ${String(path)}`)
  }
  // Block protocol-relative ("//x", "/\x") and any embedded scheme ("http:", "javascript:").
  if (/^\/[/\\]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error(`Rejected non-same-origin API path: ${path}`)
  }
  // Resolve against the current origin and confirm it did not escape it.
  const resolved = new URL(path, window.location.origin)
  if (resolved.origin !== window.location.origin) {
    throw new Error(`Rejected cross-origin API path: ${path}`)
  }
}

export async function dualApiClient<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { backend = 'unified-orchestrator', method = 'GET', body, params } = options

  // SSRF guard: never allow a caller-supplied path to target another origin.
  assertSafeApiPath(path)

  // Determine headers based on backend
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }

  if (backend === 'migration-refinery') {
    // Auth handled by Vite proxy / ALB — no client-side API key needed
  } else {
    // Use unified orchestrator authentication (session-based)
    headers['Content-Type'] = 'application/json'
  }

  if (body) {
    headers['Content-Type'] = 'application/json'
  }

  // Build URL with query parameters
  let url: string
  if (backend === 'unified-orchestrator') {
    // For unified orchestrator, use relative paths directly
    const queryParams = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.set(key, String(value))
        }
      })
    }
    const queryString = queryParams.toString()
    url = queryString ? `${path}?${queryString}` : path
  } else {
    // For migration-refinery, use /mr-api proxy to avoid CORS
    const proxyPath = `/mr-api${path.startsWith('/api') ? path.slice(4) : path}`
    const proxyUrl = new URL(proxyPath, window.location.origin)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          proxyUrl.searchParams.set(key, String(value))
        }
      })
    }
    url = proxyUrl.pathname + proxyUrl.search
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: backend === 'unified-orchestrator' ? 'include' : 'omit',
  })

  if (!response.ok) {
    throw new Error(`API error ${response.status} from ${method} ${url}`)
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T
  }

  return response.json() as Promise<T>
}
