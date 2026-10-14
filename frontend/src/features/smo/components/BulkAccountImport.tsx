import { useState, useRef } from 'react'
import Table from '@cloudscape-design/components/table'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Header from '@cloudscape-design/components/header'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import Checkbox from '@cloudscape-design/components/checkbox'
import { parseCSV } from '../utils/csv'
import type { RegisterAccountParams } from '../services/api'

interface BulkAccountImportProps {
    onRegister: (params: RegisterAccountParams) => Promise<unknown>
    onRefresh: () => void
}

interface ValidatedRow {
    row: Record<string, string>
    valid: boolean
    errors: string[]
    account: RegisterAccountParams | null
    _index: number
}

interface SubmitResults {
    succeeded: number
    failed: number
    errors: string[]
}

const ACCOUNT_CSV_COLUMNS = ['alias', 'accountId', 'externalId', 'crossAccountRoleName']
const MAX_ROWS = 200

/**
 * Validate a single parsed CSV row for account registration.
 */
function validateAccountRow(
    row: Record<string, string>,
    rowIndex: number
): { valid: boolean; errors: string[]; account: RegisterAccountParams | null } {
    const errors: string[] = []
    const alias = (row.alias || '').trim()
    const accountId = (row.accountId || '').trim()
    const externalId = (row.externalId || '').trim()
    const rawRoleName = (row.crossAccountRoleName || '').trim()

    if (!alias) {
        errors.push(`Row ${rowIndex + 1}: missing required field "alias"`)
    }
    if (!/^\d{12}$/.test(accountId)) {
        errors.push(`Row ${rowIndex + 1}: invalid accountId "${accountId}". Must be exactly 12 digits`)
    }
    if (!externalId) {
        errors.push(`Row ${rowIndex + 1}: missing required field "externalId"`)
    }
    if (rawRoleName && (!/^[a-zA-Z0-9\-_./]+$/.test(rawRoleName) || rawRoleName.length > 64)) {
        errors.push(`Row ${rowIndex + 1}: invalid crossAccountRoleName "${rawRoleName}"`)
    }

    const crossAccountRoleName = rawRoleName || 'StorageSyncCrossAccountRole'
    const valid = errors.length === 0

    return {
        valid,
        errors,
        account: valid
            ? { targetAccountId: accountId, alias, externalId, crossAccountRoleName }
            : null,
    }
}

/**
 * Detect duplicate accountId and alias values across validated rows.
 */
function detectDuplicates(validatedRows: ValidatedRow[]): string[] {
    const warnings: string[] = []
    const idCounts: Record<string, number> = {}
    const aliasCounts: Record<string, number> = {}

    for (const r of validatedRows) {
        if (!r.valid || !r.account) continue
        idCounts[r.account.targetAccountId] = (idCounts[r.account.targetAccountId] || 0) + 1
        aliasCounts[r.account.alias] = (aliasCounts[r.account.alias] || 0) + 1
    }

    const dupIds = Object.entries(idCounts).filter(([, c]) => c > 1).map(([id]) => id)
    const dupAliases = Object.entries(aliasCounts).filter(([, c]) => c > 1).map(([al]) => al)

    if (dupIds.length > 0) warnings.push(`Duplicate account IDs: ${dupIds.join(', ')}`)
    if (dupAliases.length > 0) warnings.push(`Duplicate aliases: ${dupAliases.join(', ')}`)
    return warnings
}

/**
 * Convert parseCSV's string[][] output into row objects keyed by header names.
 */
function csvToRowObjects(data: string[][]): Record<string, string>[] {
    if (data.length < 2) return []
    const headers = data[0]
    return data.slice(1).map(values => {
        const row: Record<string, string> = {}
        headers.forEach((h, idx) => {
            row[h.trim()] = (values[idx] || '').trim()
        })
        return row
    })
}

export default function BulkAccountImport({ onRegister, onRefresh }: BulkAccountImportProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [parsedRows, setParsedRows] = useState<ValidatedRow[]>([])
    const [fileError, setFileError] = useState<string | null>(null)
    const [fileName, setFileName] = useState('')
    const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([])
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
    const [submitting, setSubmitting] = useState(false)
    const [submitProgress, setSubmitProgress] = useState(0)
    const [submitResults, setSubmitResults] = useState<SubmitResults | null>(null)
    const [failedAccounts, setFailedAccounts] = useState<RegisterAccountParams[]>([])

    function downloadTemplate(): void {
        const header = ACCOUNT_CSV_COLUMNS.join(',')
        const example = 'prod-target,123456789012,a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d,StorageSyncCrossAccountRole'
        const csv = header + '\n' + example + '\n'
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'account-registration-template.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    function handleReset() {
        setParsedRows([])
        setFileError(null)
        setFileName('')
        setDuplicateWarnings([])
        setSelectedRows(new Set())
        setSubmitting(false)
        setSubmitProgress(0)
        setSubmitResults(null)
        setFailedAccounts([])
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) return

        handleReset()
        setFileName(file.name)

        if (!file.name.toLowerCase().endsWith('.csv')) {
            setFileError('Please select a CSV file (.csv)')
            return
        }

        const reader = new FileReader()
        reader.onload = (e) => {
            const text = e.target?.result as string
            if (!text?.trim()) {
                setFileError('The selected file is empty')
                return
            }

            const data = parseCSV(text)
            const rows = csvToRowObjects(data)

            if (rows.length === 0) {
                setFileError('No data rows found in CSV file')
                return
            }
            if (rows.length > MAX_ROWS) {
                setFileError(`CSV contains ${rows.length} rows. Maximum is ${MAX_ROWS} accounts per upload.`)
                return
            }

            const validated: ValidatedRow[] = rows.map((row, idx) => ({
                row,
                ...validateAccountRow(row, idx),
                _index: idx,
            }))

            setDuplicateWarnings(detectDuplicates(validated))
            setParsedRows(validated)

            // Select all valid rows by default
            const validIndices = new Set<number>()
            validated.forEach((r, i) => { if (r.valid) validIndices.add(i) })
            setSelectedRows(validIndices)
        }
        reader.onerror = () => {
            setFileError(`Failed to read file: ${reader.error?.message || 'unknown error'}`)
        }
        reader.readAsText(file)
    }

    function toggleRow(index: number) {
        setSelectedRows(prev => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    function toggleAll() {
        const validIndices = parsedRows
            .map((r, i) => (r.valid ? i : -1))
            .filter(i => i >= 0)
        const allSelected = validIndices.every(i => selectedRows.has(i))
        if (allSelected) {
            setSelectedRows(new Set())
        } else {
            setSelectedRows(new Set(validIndices))
        }
    }

    async function handleSubmitSelected() {
        const selected = parsedRows.filter(r => selectedRows.has(r._index) && r.valid)
        if (selected.length === 0) return

        setSubmitting(true)
        setSubmitProgress(0)
        setSubmitResults(null)
        setFailedAccounts([])

        const results: SubmitResults = { succeeded: 0, failed: 0, errors: [] }
        const failures: RegisterAccountParams[] = []

        for (let i = 0; i < selected.length; i++) {
            const item = selected[i]
            try {
                await onRegister(item.account!)
                results.succeeded++
            } catch (err) {
                results.failed++
                const label = item.account!.alias || item.account!.targetAccountId
                results.errors.push(`${label}: ${(err as Error).message || 'Registration failed'}`)
                failures.push(item.account!)
            }
            setSubmitProgress(Math.round(((i + 1) / selected.length) * 100))
        }

        setSubmitResults(results)
        setFailedAccounts(failures)
        setSubmitting(false)
        onRefresh()
    }

    async function handleRetryFailed() {
        if (failedAccounts.length === 0) return

        setSubmitting(true)
        setSubmitProgress(0)

        const results: SubmitResults = { succeeded: 0, failed: 0, errors: [] }
        const failures: RegisterAccountParams[] = []

        for (let i = 0; i < failedAccounts.length; i++) {
            const acct = failedAccounts[i]
            try {
                await onRegister(acct)
                results.succeeded++
            } catch (err) {
                results.failed++
                results.errors.push(
                    `${acct.alias || acct.targetAccountId}: ${(err as Error).message || 'Registration failed'}`
                )
                failures.push(acct)
            }
            setSubmitProgress(Math.round(((i + 1) / failedAccounts.length) * 100))
        }

        setSubmitResults(results)
        setFailedAccounts(failures)
        setSubmitting(false)
        onRefresh()
    }

    const validCount = parsedRows.filter(r => r.valid).length
    const allErrors = parsedRows.flatMap(r => r.errors)
    const validIndices = parsedRows.map((r, i) => (r.valid ? i : -1)).filter(i => i >= 0)
    const allValidSelected = validIndices.length > 0 && validIndices.every(i => selectedRows.has(i))

    const columnDefinitions = [
        {
            id: 'select',
            header: (
                <Checkbox
                    checked={allValidSelected}
                    onChange={toggleAll}
                    ariaLabel="Select all valid rows"
                />
            ),
            cell: (item: ValidatedRow) => (
                <Checkbox
                    checked={selectedRows.has(item._index)}
                    disabled={!item.valid}
                    onChange={() => toggleRow(item._index)}
                    ariaLabel={`Select row ${item._index + 1}`}
                />
            ),
            width: 50,
        },
        { id: 'alias', header: 'Alias', cell: (item: ValidatedRow) => item.row.alias || '—' },
        { id: 'accountId', header: 'Account ID', cell: (item: ValidatedRow) => item.row.accountId || '—' },
        { id: 'externalId', header: 'External ID', cell: (item: ValidatedRow) => item.row.externalId || '—' },
        {
            id: 'roleName',
            header: 'Role Name',
            cell: (item: ValidatedRow) => item.row.crossAccountRoleName || 'StorageSyncCrossAccountRole',
        },
        {
            id: 'status',
            header: 'Status',
            cell: (item: ValidatedRow) =>
                item.valid
                    ? <StatusIndicator type="success">Valid</StatusIndicator>
                    : <StatusIndicator type="error">{item.errors[0] || 'Invalid'}</StatusIndicator>,
        },
    ]

    return (
        <SpaceBetween size="m">
            <Header
                variant="h3"
                actions={
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button onClick={downloadTemplate} iconName="download">
                            Download Template
                        </Button>
                        <Button
                            onClick={() => fileInputRef.current?.click()}
                            iconName="upload"
                        >
                            Upload CSV
                        </Button>
                        {parsedRows.length > 0 && (
                            <Button onClick={handleReset} variant="link">Clear</Button>
                        )}
                    </SpaceBetween>
                }
            >
                Bulk Account Registration
            </Header>

            <input
                type="file"
                accept=".csv"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
                aria-label="Account CSV file input"
            />

            {fileError && (
                <Alert type="error" dismissible onDismiss={() => setFileError(null)}>
                    {fileError}
                </Alert>
            )}

            {allErrors.length > 0 && (
                <Alert type="warning" header={`Validation errors (${allErrors.length})`}>
                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                        {allErrors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                </Alert>
            )}

            {duplicateWarnings.length > 0 && (
                <Alert type="warning" header="Duplicate warnings">
                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                        {duplicateWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                </Alert>
            )}

            {parsedRows.length > 0 && (
                <Table
                    columnDefinitions={columnDefinitions}
                    items={parsedRows}
                    header={
                        <Header counter={`(${validCount} of ${parsedRows.length} valid)`}>
                            {fileName || 'Uploaded Accounts'}
                        </Header>
                    }
                    empty={
                        <Box textAlign="center" color="inherit" padding="l">
                            No accounts parsed
                        </Box>
                    }
                    ariaLabels={{ tableLabel: 'Bulk account registration preview' }}
                />
            )}

            {submitting && (
                <ProgressBar
                    value={submitProgress}
                    label="Registering accounts..."
                    description={`${submitProgress}% complete`}
                />
            )}

            {submitResults && (
                <Alert
                    type={submitResults.failed === 0 ? 'success' : 'warning'}
                    header={`${submitResults.succeeded} succeeded, ${submitResults.failed} failed`}
                >
                    {submitResults.errors.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                            {submitResults.errors.map((e, i) => <li key={i}>{e}</li>)}
                        </ul>
                    )}
                </Alert>
            )}

            {parsedRows.length > 0 && (
                <SpaceBetween direction="horizontal" size="xs">
                    <Button
                        variant="primary"
                        onClick={handleSubmitSelected}
                        disabled={submitting || selectedRows.size === 0}
                        loading={submitting}
                    >
                        {`Register Selected (${selectedRows.size})`}
                    </Button>
                    {failedAccounts.length > 0 && !submitting && (
                        <Button onClick={handleRetryFailed} iconName="refresh">
                            {`Retry Failed (${failedAccounts.length})`}
                        </Button>
                    )}
                </SpaceBetween>
            )}
        </SpaceBetween>
    )
}
