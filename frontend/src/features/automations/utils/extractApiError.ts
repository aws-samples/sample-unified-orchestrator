/**
 * Extract a human-readable error message from an API error response.
 * Falls back to the provided default message when the error shape is unrecognised.
 */
export function extractApiError(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>

    // Axios-style wrapped response — check this FIRST before err.message
    if (typeof obj.response === 'object' && obj.response !== null) {
      const data = (obj.response as Record<string, unknown>).data
      if (typeof data === 'string') return data
      if (typeof data === 'object' && data !== null) {
        const d = data as Record<string, unknown>
        if (typeof d.message === 'string') return d.message
        if (typeof d.detail === 'string') return d.detail
        if (typeof d.error === 'string') return d.error
      }
    }

    // Plain object with message / detail
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.detail === 'string') return obj.detail
  }

  if (err instanceof Error) {
    return err.message
  }

  if (typeof err === 'string') return err

  return fallback
}
