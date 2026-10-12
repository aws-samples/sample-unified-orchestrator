import type { PageState } from '../services/iacAgent'
import { iacAgentApi } from '../services/iacAgent'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ACTIVE_SESSION_STATES = ['generating', 'review', 'approved', 'publishing', 'published', 'error'] as const
export type ActiveSessionState = (typeof ACTIVE_SESSION_STATES)[number]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map key format: "motsId:environment" */
export type SessionStatusKey = `${string}:${string}`

export interface StatusResult {
  key: string
  pageState: PageState | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a map key from a MOTS ID and environment. */
export function makeStatusKey(motsId: string, environment: string): SessionStatusKey {
  return `${motsId}:${environment}`
}

/**
 * Extract environment keys from an AppCatalogRecord.
 * Environment keys are derived from record properties ending in `_runtime_values`
 * with the suffix stripped (e.g. `dev_runtime_values` → `dev`).
 */
export function getEnvironmentKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record)
    .filter((k) => k.endsWith('_runtime_values'))
    .map((k) => k.replace('_runtime_values', ''))
}

/**
 * Return only the active session states for a given MOTS ID across its environments.
 * Looks up each environment in the status map and keeps entries whose state
 * is in {@link ACTIVE_SESSION_STATES}.
 */
export function getActiveStates(
  motsId: string,
  environments: string[],
  sessionStatuses: Map<string, PageState>,
): Array<{ environment: string; pageState: PageState }> {
  const result: Array<{ environment: string; pageState: PageState }> = []

  for (const env of environments) {
    const pageState = sessionStatuses.get(makeStatusKey(motsId, env))
    if (pageState && (ACTIVE_SESSION_STATES as readonly string[]).includes(pageState.state)) {
      result.push({ environment: env, pageState })
    }
  }

  return result
}


/**
 * Fetch session statuses for a batch of (motsId, environment) pairs with
 * a concurrency limiter to avoid overwhelming the API.
 *
 * On per-call error the result entry gets `pageState: null` so callers can
 * treat that pair as having no active session.
 */
export async function fetchSessionStatusesBatch(
  pairs: Array<{ motsId: string; environment: string }>,
  concurrency = 5,
): Promise<StatusResult[]> {
  const results: StatusResult[] = []

  for (let i = 0; i < pairs.length; i += concurrency) {
    const chunk = pairs.slice(i, i + concurrency)

    const settled = await Promise.allSettled(
      chunk.map(async ({ motsId, environment }) => {
        const key = makeStatusKey(motsId, environment)
        try {
          const response = await iacAgentApi.getSessionStatus(motsId, environment)
          return { key, pageState: response.data } as StatusResult
        } catch {
          return { key, pageState: null } as StatusResult
        }
      }),
    )

    for (const entry of settled) {
      // Each promise in the chunk already catches internally, so they always fulfill.
      // The allSettled wrapper is a safety net.
      if (entry.status === 'fulfilled') {
        results.push(entry.value)
      }
    }
  }

  return results
}
