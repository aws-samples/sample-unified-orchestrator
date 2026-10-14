/**
 * CSV parsing, serialization, and validation utilities for bulk job import.
 */

/** The 15 column headers for job CSV files. */
export const CSV_COLUMNS: string[] = [
    'jobName',
    'sourceHost',
    'targetInstanceId',
    'sshKeyArn',
    'sourcePath',
    'targetPath',
    'operatingSystem',
    'targetAccountAlias',
    'bandwidthLimit',
    'excludePatterns',
    'tags',
    'credentialType',
    'credentialFormat',
    'transferEngine',
    'targetRegion',
]

const REQUIRED_FIELDS = [
    'jobName',
    'sourceHost',
    'targetInstanceId',
    'sshKeyArn',
    'sourcePath',
    'targetPath',
]

const VALID_OS = ['linux', 'windows', 'unix']
const VALID_CRED_FORMATS = ['sshkey', 'userpass']
const VALID_ENGINES = ['rsync', 'rclone']

/**
 * Parse a single CSV line into fields, handling quoted values and escaped quotes.
 */
function parseLine(line: string): string[] {
    const fields: string[] = []
    let field = ''
    let quoted = false

    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') {
                field += '"'
                i++
            } else {
                quoted = !quoted
            }
        } else if (ch === ',' && !quoted) {
            const trimmed = field.trim()
            const sanitized = /^[=+\-@\t\r]/.test(trimmed) ? `'${trimmed}` : trimmed
            fields.push(sanitized)
            field = ''
        } else {
            field += ch
        }
    }
    const lastTrimmed = field.trim()
    const lastSanitized = /^[=+\-@\t\r]/.test(lastTrimmed) ? `'${lastTrimmed}` : lastTrimmed
    fields.push(lastSanitized)
    return fields
}

/**
 * Parse CSV text into a 2D string array.
 * Handles quoted fields containing commas, escaped double-quotes, and multi-line values.
 * The first row is the header row.
 */
export function parseCSV(text: string): string[][] {
    if (!text || !text.trim()) return []

    // Split into logical lines, respecting quoted multi-line values
    const lines: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"') {
            inQuotes = !inQuotes
            current += ch
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (current.trim()) lines.push(current)
            current = ''
            if (ch === '\r' && text[i + 1] === '\n') i++
        } else {
            current += ch
        }
    }
    if (current.trim()) lines.push(current)

    if (lines.length === 0) return []

    return lines.map((line) => parseLine(line))
}


/**
 * Serialize an array of job config objects to valid CSV text.
 * Quotes fields that contain commas, double-quotes, or newlines.
 */
export function serializeCSV(jobs: Record<string, unknown>[]): string {
    if (!jobs || jobs.length === 0) return ''

    const header = CSV_COLUMNS.join(',')

    const rows = jobs.map((job) => {
        return CSV_COLUMNS.map((col) => {
            let val = ''
            if (col === 'tags') {
                val = Array.isArray(job.tags)
                    ? (job.tags as string[]).join(',')
                    : String(job.tags ?? '')
            } else {
                val = job[col] != null ? String(job[col]) : ''
            }
            // Quote fields that contain commas, quotes, or newlines
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = '"' + val.replace(/"/g, '""') + '"'
            }
            return val
        }).join(',')
    })

    return [header, ...rows].join('\n')
}

/**
 * Validate a parsed CSV row and return validation results.
 *
 * Checks required fields, OS values, credential format, transfer engine,
 * path pair count matching, and account alias resolution.
 */
export function validateRow(
    row: Record<string, string>,
    index: number,
    accounts: Array<{ alias: string; accountId?: string }>
): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
        if (!row[field] || !row[field].trim()) {
            errors.push(`Row ${index}: missing required field "${field}"`)
        }
    }

    // Validate OS
    const os = (row.operatingSystem || '').trim().toLowerCase()
    if (os && !VALID_OS.includes(os)) {
        errors.push(
            `Row ${index}: invalid operatingSystem "${row.operatingSystem}". Must be Linux, Windows, or Unix`
        )
    }

    if (errors.length > 0) return { valid: false, errors }

    // Validate path pair count matching
    const srcPaths = row.sourcePath
        .trim()
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    const tgtPaths = row.targetPath
        .trim()
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)

    if (
        srcPaths.length > 0 &&
        tgtPaths.length > 0 &&
        srcPaths.length !== tgtPaths.length
    ) {
        return {
            valid: false,
            errors: [
                `Row ${index}: sourcePath has ${srcPaths.length} paths but targetPath has ${tgtPaths.length} paths`,
            ],
        }
    }

    if (srcPaths.length === 0) {
        return {
            valid: false,
            errors: [`Row ${index}: at least one path pair is required`],
        }
    }

    // Validate account alias resolution
    const alias = (row.targetAccountAlias || '').trim()
    if (alias) {
        const acctList = accounts || []
        const account = acctList.find(
            (a) => a.alias && a.alias.toLowerCase() === alias.toLowerCase()
        )
        if (!account && !/^\d{12}$/.test(alias)) {
            return {
                valid: false,
                errors: [
                    `Row ${index}: target account alias "${alias}" not found in registered accounts`,
                ],
            }
        }
    }

    // Validate credential format
    const credFormat = (row.credentialFormat || '').trim().toLowerCase()
    if (credFormat && !VALID_CRED_FORMATS.includes(credFormat)) {
        return {
            valid: false,
            errors: [
                `Row ${index}: invalid credentialFormat "${row.credentialFormat}". Must be 'sshkey' or 'userpass'`,
            ],
        }
    }

    // Validate transfer engine
    const engine = (row.transferEngine || '').trim().toLowerCase()
    if (engine && !VALID_ENGINES.includes(engine)) {
        return {
            valid: false,
            errors: [
                `Row ${index}: invalid transferEngine "${row.transferEngine}". Must be 'rsync' or 'rclone'`,
            ],
        }
    }

    const normalizedOs = os ? os.charAt(0).toUpperCase() + os.slice(1) : 'Linux'
    if (engine === 'rclone' && normalizedOs === 'Windows') {
        return {
            valid: false,
            errors: [
                `Row ${index}: rclone transfer engine is only supported for Linux operating system`,
            ],
        }
    }

    // Validate target region format (optional field)
    const region = (row.targetRegion || '').trim()
    if (region && !/^[a-z]{2}-[a-z]+-\d{1,2}$/.test(region)) {
        return {
            valid: false,
            errors: [
                `Row ${index}: invalid targetRegion "${row.targetRegion}". Must match AWS region format (e.g., us-east-1)`,
            ],
        }
    }

    return { valid: true, errors: [] }
}
