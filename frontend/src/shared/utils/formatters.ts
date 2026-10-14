/**
 * Shared formatting utilities.
 * Consolidated from features/smo/utils/formatters.ts and features/uno/utils/formatters.ts.
 */

/**
 * Format an ISO date string into a short localized date (e.g. "Jan 5, 2025").
 */
export function formatDate(date: string | number | undefined): string {
  if (!date) return '—'
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

/**
 * Format an ISO date string into a localized date + time string.
 */
export function formatDateTime(date: string | number | undefined): string {
  if (!date) return '—'
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return '—'
    return (
      d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }) +
      ' ' +
      d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    )
  } catch {
    return '—'
  }
}

/**
 * Format a byte count into a human-readable size string.
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i]
}

/**
 * Format a duration in milliseconds into a human-readable string.
 */
export function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—'
  const seconds = Math.floor(ms / 1000)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Format an ISO date string into a relative time description (e.g. "3h ago").
 */
export function formatTimeAgo(dateStr: string | undefined): string {
  if (!dateStr) return ''
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    if (isNaN(diff)) return ''
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}

/**
 * Format a numeric score as a percentage (e.g. "87.5%").
 */
export function formatScore(score: number): string {
  return `${score.toFixed(1)}%`
}

/**
 * Format a risk level string with title case (e.g. "high" → "High").
 */
export function formatRiskLevel(level: string): string {
  return level.charAt(0).toUpperCase() + level.slice(1).toLowerCase()
}
