import { useState, useCallback } from 'react'
import type { PageState } from '../services/iacAgent'
import { iacAgentApi } from '../services/iacAgent'
import { fetchSessionStatusesBatch, makeStatusKey } from '../utils/sessionStatusUtils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseSessionStatusesReturn {
  sessionStatuses: Map<string, PageState>
  refreshAll: (items: Record<string, unknown>[]) => Promise<void>
  refreshRow: (motsId: string, environments: string[]) => Promise<void>
  isRefreshingAll: boolean
  refreshingRows: Set<string>
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionStatuses(): UseSessionStatusesReturn {
  const [sessionStatuses, setSessionStatuses] = useState<Map<string, PageState>>(new Map())
  const [isRefreshingAll, setIsRefreshingAll] = useState(false)
  const [refreshingRows, setRefreshingRows] = useState<Set<string>>(new Set())

  const refreshAll = useCallback(async (_items: Record<string, unknown>[]) => {
    if (isRefreshingAll) return

    setIsRefreshingAll(true)
    try {
      // Single API call to get all active sessions via status-index GSI
      const { data } = await iacAgentApi.getActiveSessions()
      const next = new Map<string, PageState>()
      for (const session of data) {
        const key = makeStatusKey(session.mots_id, session.environment)
        next.set(key, session)
      }
      setSessionStatuses(next)
    } catch {
      // On error, clear statuses — user can retry
      setSessionStatuses(new Map())
    } finally {
      setIsRefreshingAll(false)
    }
  }, [isRefreshingAll])

  const refreshRow = useCallback(async (motsId: string, environments: string[]) => {
    if (refreshingRows.has(motsId)) return

    setRefreshingRows((prev) => {
      const next = new Set(prev)
      next.add(motsId)
      return next
    })
    try {
      const pairs = environments.map((env) => ({ motsId, environment: env }))
      const results = await fetchSessionStatusesBatch(pairs)

      setSessionStatuses((prev) => {
        const next = new Map(prev)
        // Clear existing entries for this row's environments
        for (const env of environments) {
          next.delete(makeStatusKey(motsId, env))
        }
        // Set successful results
        for (const { key, pageState } of results) {
          if (pageState) {
            next.set(key, pageState)
          }
        }
        return next
      })
    } finally {
      setRefreshingRows((prev) => {
        const next = new Set(prev)
        next.delete(motsId)
        return next
      })
    }
  }, [refreshingRows])

  return { sessionStatuses, refreshAll, refreshRow, isRefreshingAll, refreshingRows }
}
