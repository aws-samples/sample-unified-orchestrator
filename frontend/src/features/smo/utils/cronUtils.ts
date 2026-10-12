/**
 * Cron expression formatting for schedule display.
 * Handles EventBridge 6-part cron format: "minute hour day month ? year"
 */

/**
 * Parse a cron expression + timezone + scheduleType into a human-readable string.
 *
 * @param cron - EventBridge format cron (e.g. "0 2 15 6 ? 2025" or "0 2 * * ? *")
 * @param timezone - 'UTC' or IANA timezone string
 * @param scheduleType - 'once' or 'recurring'
 * @returns Human-readable schedule description
 */
export function formatCronExpression(
    cron: string,
    timezone: string,
    scheduleType: 'once' | 'recurring'
): string {
    if (!cron) return 'Invalid schedule'

    try {
        const parts = cron.split(' ')
        if (parts.length < 6) return cron

        const minute = parseInt(parts[0])
        const hour = parseInt(parts[1])
        const day = parts[2] !== '*' ? parseInt(parts[2]) : null
        const month = parts[3] !== '*' ? parseInt(parts[3]) : null
        const year =
            parts.length > 5 && parts[5] !== '*' ? parseInt(parts[5]) : null

        if (isNaN(minute) || isNaN(hour)) return cron

        // Cron values are always in UTC — build a UTC Date
        let utcDate: Date
        if (scheduleType === 'once' && day && month && year) {
            utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute))
        } else {
            const now = new Date()
            utcDate = new Date(
                Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    hour,
                    minute
                )
            )
        }

        const displayTz = !timezone || timezone === 'UTC' ? 'UTC' : 'Local'
        const tzOption =
            displayTz === 'UTC' ? ({ timeZone: 'UTC' } as const) : {}

        if (scheduleType === 'once' && day && month && year) {
            const dateString = utcDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                ...tzOption,
            })
            const timeString = utcDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                ...tzOption,
            })
            return `${dateString} at ${timeString} ${displayTz}`
        }

        // Recurring
        const timeString = utcDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            ...tzOption,
        })
        return `Daily at ${timeString} ${displayTz}`
    } catch {
        return cron || 'Invalid schedule'
    }
}
