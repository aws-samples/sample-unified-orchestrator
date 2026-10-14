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
import { parseCSV, validateRow, CSV_COLUMNS } from '../utils/csv'
import type { CreateJobParams, Account, SyncJob } from '../services/api'

interface BulkImportProps {
    onCreateJob: (config: CreateJobParams) => Promise<SyncJob>
    accounts: Account[]
}

interface ParsedJob {
    jobName: string
    sourceHost: string
    targetInstanceId: string
    sshKeyArn: string
    operatingSystem: string
    pathPairs: Array<{ sourcePath: string; targetPath: string }>
    bandwidthLimit?: string
    excludePatterns?: string
    tags?: string[]
    targetAccountId?: string
    targetAccountAlias?: string
    credentialType: string
    credentialFormat?: string
    transferEngine?: string
}

interface SubmitResults {
    succeeded: number
    failed: number
    errors: string[]
}

const MAX_ROWS = 100

/**
 * Build a typed job config from a validated CSV row object.
 */
function buildJobFromRow(
    row: Record<string, string>,
    accounts: Account[]
): ParsedJob {
    const os = (row.operatingSystem || '').trim().toLowerCase()
    const normalizedOs = os ? os.charAt(0).toUpperCase() + os.slice(1) : 'Linux'

    const srcPaths = row.sourcePath.trim().split(',').map(p => p.trim()).filter(Boolean)
    const tgtPaths = row.targetPath.trim().split(',').map(p => p.trim()).filter(Boolean)
    const pathPairs = srcPaths.map((src, i) => ({
        sourcePath: src,
        targetPath: tgtPaths[i] || src,
    }))

    const job: ParsedJob = {
        jobName: row.jobName.trim(),
        sourceHost: row.sourceHost.trim(),
        targetInstanceId: row.targetInstanceId.trim(),
        sshKeyArn: row.sshKeyArn.trim(),
        operatingSystem: normalizedOs,
        pathPairs,
        credentialType: (row.credentialType || '').trim().toLowerCase() === 'parameterstore'
            ? 'parameterstore'
            : 'secretsmanager',
    }

    if (row.bandwidthLimit?.trim()) job.bandwidthLimit = row.bandwidthLimit.trim()
    if (row.excludePatterns?.trim()) job.excludePatterns = row.excludePatterns.trim()
    if (row.tags?.trim()) job.tags = row.tags.split(',').map(t => t.trim()).filter(Boolean)

    const alias = (row.targetAccountAlias || '').trim()
    if (alias) {
        const account = accounts.find(a => a.alias?.toLowerCase() === alias.toLowerCase())
        if (account) {
            job.targetAccountId = account.accountId
            job.targetAccountAlias = account.alias
        } else if (/^\d{12}$/.test(alias)) {
            job.targetAccountId = alias
        }
    }

    const credFormat = (row.credentialFormat || '').trim().toLowerCase()
    if (credFormat === 'userpass') job.credentialFormat = 'username-password'

    const engine = (row.transferEngine || '').trim().toLowerCase()
    if (engine === 'rclone') job.transferEngine = 'rclone'

    const region = (row.targetRegion || '').trim()
    if (region) (job as unknown as Record<string, unknown>).targetRegion = region

    return job
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

/**
 * Trigger download of a CSV template file.
 */
function downloadTemplate(): void {
    const header = CSV_COLUMNS.join(',')
    const example = [
        'My Sync Job', '10.0.1.100', 'i-0abc123def456',
        'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-ssh-key',
        '/data/app', '/mnt/data/app', 'Linux', 'my-target-account',
        '0', '', '', 'secretsmanager', 'sshkey', 'rsync',
    ].join(',')
    const csv = header + '\n' + example + '\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sync-jobs-template.csv'
    a.click()
    URL.revokeObjectURL(url)
}

export default function BulkImport({ onCreateJob, accounts }: BulkImportProps) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [parsedJobs, setParsedJobs] = useState<ParsedJob[]>([])
    const [parseErrors, setParseErrors] = useState<string[]>([])
    const [fileError, setFileError] = useState('')
    const [fileName, setFileName] = useState('')
    const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([])
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
    const [submitting, setSubmitting] = useState(false)
    const [submitProgress, setSubmitProgress] = useState(0)
    const [submitResults, setSubmitResults] = useState<SubmitResults | null>(null)
    const [failedJobs, setFailedJobs] = useState<ParsedJob[]>([])

    function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) return

        setFileError('')
        setParsedJobs([])
        setParseErrors([])
        setSubmitResults(null)
        setSubmitProgress(0)
        setDuplicateWarnings([])
        setSelectedRows(new Set())
        setFailedJobs([])

        if (!file.name.toLowerCase().endsWith('.csv')) {
            setFileError('Please select a CSV file (.csv)')
            event.target.value = ''
            return
        }

        setFileName(file.name)

        const reader = new FileReader()
        reader.onload = (e) => {
            const csvText = e.target?.result as string
            if (!csvText?.trim()) {
                setFileError('The selected file is empty')
                return
            }

            const data = parseCSV(csvText)
            const rows = csvToRowObjects(data)

            if (rows.length === 0) {
                setFileError('No data rows found in CSV file')
                return
            }
            if (rows.length > MAX_ROWS) {
                setFileError(`CSV contains ${rows.length} rows. Maximum is ${MAX_ROWS} jobs per upload.`)
                return
            }

            const acctList = accounts || []
            const valid: ParsedJob[] = []
            const errors: string[] = []

            rows.forEach((row, idx) => {
                const result = validateRow(row, idx + 1, acctList)
                if (result.valid) {
                    valid.push(buildJobFromRow(row, acctList))
                } else {
                    errors.push(...result.errors)
                }
            })

            // Detect duplicate job names
            const nameCounts: Record<string, number> = {}
            valid.forEach(job => {
                nameCounts[job.jobName] = (nameCounts[job.jobName] || 0) + 1
            })
            const warnings = Object.entries(nameCounts)
                .filter(([, count]) => count > 1)
                .map(([name, count]) => `Duplicate jobName "${name}" appears ${count} times`)
            setDuplicateWarnings(warnings)

            setParsedJobs(valid)
            setParseErrors(errors)
            setSelectedRows(new Set(valid.map((_, i) => i)))
        }

        reader.readAsText(file)
        event.target.value = ''
    }

    async function handleSubmitSelected() {
        if (!onCreateJob || parsedJobs.length === 0) return
        const jobsToSubmit = parsedJobs.filter((_, i) => selectedRows.has(i))
        if (jobsToSubmit.length === 0) return

        setSubmitting(true)
        setSubmitResults(null)
        setSubmitProgress(0)
        setFailedJobs([])

        const results: SubmitResults = { succeeded: 0, failed: 0, errors: [] }
        const failed: ParsedJob[] = []

        for (let i = 0; i < jobsToSubmit.length; i++) {
            try {
                await onCreateJob(jobsToSubmit[i] as unknown as CreateJobParams)
                results.succeeded++
            } catch (err) {
                results.failed++
                results.errors.push(`${jobsToSubmit[i].jobName}: ${(err as Error).message}`)
                failed.push(jobsToSubmit[i])
            }
            setSubmitProgress(Math.round(((i + 1) / jobsToSubmit.length) * 100))
        }

        setSubmitResults(results)
        setFailedJobs(failed)
        setSubmitting(false)
    }

    async function handleRetryFailed() {
        if (!onCreateJob || failedJobs.length === 0) return
        setSubmitting(true)
        setSubmitResults(null)
        setSubmitProgress(0)

        const results: SubmitResults = { succeeded: 0, failed: 0, errors: [] }
        const stillFailed: ParsedJob[] = []

        for (let i = 0; i < failedJobs.length; i++) {
            try {
                await onCreateJob(failedJobs[i] as unknown as CreateJobParams)
                results.succeeded++
            } catch (err) {
                results.failed++
                results.errors.push(`${failedJobs[i].jobName}: ${(err as Error).message}`)
                stillFailed.push(failedJobs[i])
            }
            setSubmitProgress(Math.round(((i + 1) / failedJobs.length) * 100))
        }

        setSubmitResults(results)
        setFailedJobs(stillFailed)
        setSubmitting(false)
    }

    function handleReset() {
        setParsedJobs([])
        setParseErrors([])
        setFileError('')
        setFileName('')
        setSubmitResults(null)
        setSubmitProgress(0)
        setDuplicateWarnings([])
        setSelectedRows(new Set())
        setFailedJobs([])
    }

    function toggleRow(index: number) {
        setSelectedRows(prev => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    function toggleAll(checked: boolean) {
        if (checked) {
            setSelectedRows(new Set(parsedJobs.map((_, i) => i)))
        } else {
            setSelectedRows(new Set())
        }
    }

    const allSelected = parsedJobs.length > 0 && selectedRows.size === parsedJobs.length
    const selectedCount = selectedRows.size
    const submitLabel = allSelected
        ? `Submit All (${parsedJobs.length})`
        : `Submit Selected (${selectedCount})`

    const columnDefinitions = [
        {
            id: 'select',
            header: (
                <Checkbox
                    checked={allSelected}
                    indeterminate={selectedCount > 0 && !allSelected}
                    onChange={({ detail }) => toggleAll(detail.checked)}
                    ariaLabel="Select all rows"
                />
            ),
            cell: (item: ParsedJob) => {
                const idx = parsedJobs.indexOf(item)
                return (
                    <Checkbox
                        checked={selectedRows.has(idx)}
                        onChange={() => toggleRow(idx)}
                        ariaLabel={`Select ${item.jobName}`}
                    />
                )
            },
            width: 50,
        },
        { id: 'jobName', header: 'Job Name', cell: (item: ParsedJob) => item.jobName },
        { id: 'sourceHost', header: 'Source Host', cell: (item: ParsedJob) => item.sourceHost },
        { id: 'targetInstanceId', header: 'Target Instance', cell: (item: ParsedJob) => item.targetInstanceId },
        { id: 'operatingSystem', header: 'OS', cell: (item: ParsedJob) => item.operatingSystem },
        {
            id: 'pathPairs',
            header: 'Paths',
            cell: (item: ParsedJob) =>
                item.pathPairs.map(p => `${p.sourcePath} → ${p.targetPath}`).join('; '),
        },
        {
            id: 'targetAccountAlias',
            header: 'Target Account',
            cell: (item: ParsedJob) => item.targetAccountAlias || '—',
        },
        {
            id: 'credentialType',
            header: 'Cred Type',
            cell: (item: ParsedJob) => item.credentialType || 'secretsmanager',
        },
        {
            id: 'transferEngine',
            header: 'Engine',
            cell: (item: ParsedJob) => item.transferEngine || 'rsync',
        },
        {
            id: 'tags',
            header: 'Tags',
            cell: (item: ParsedJob) => (item.tags ? item.tags.join(', ') : '—'),
        },
    ]

    const hasPreview = parsedJobs.length > 0 || parseErrors.length > 0

    return (
        <SpaceBetween size="l">
            <Header
                variant="h2"
                description="Upload a CSV file to create multiple sync jobs at once"
                actions={
                    <SpaceBetween direction="horizontal" size="xs">
                        <Button onClick={downloadTemplate} iconName="download">
                            Download Template
                        </Button>
                        <Button onClick={() => fileInputRef.current?.click()} iconName="upload">
                            Upload CSV
                        </Button>
                    </SpaceBetween>
                }
            >
                Bulk Import
            </Header>

            <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                aria-label="CSV file input"
            />

            {fileError && (
                <Alert type="error" dismissible onDismiss={() => setFileError('')}>
                    {fileError}
                </Alert>
            )}

            {parseErrors.length > 0 && (
                <Alert type="warning" header={`${parseErrors.length} validation error(s)`}>
                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                        {parseErrors.map((err, i) => (
                            <li key={i}>{err}</li>
                        ))}
                    </ul>
                </Alert>
            )}

            {duplicateWarnings.length > 0 && (
                <Alert type="warning" header="Duplicate job names detected">
                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                        {duplicateWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </Alert>
            )}

            {hasPreview && (
                <SpaceBetween size="l">
                    <Table
                        columnDefinitions={columnDefinitions}
                        items={parsedJobs}
                        header={
                            <Header
                                counter={`(${parsedJobs.length} valid job${parsedJobs.length !== 1 ? 's' : ''})`}
                                description={fileName ? `File: ${fileName}` : undefined}
                            >
                                Preview
                            </Header>
                        }
                        empty={
                            <Box textAlign="center" color="inherit" padding="l">
                                <b>No valid jobs found</b>
                                <Box variant="p" color="inherit">
                                    Check the validation errors above and fix your CSV.
                                </Box>
                            </Box>
                        }
                        ariaLabels={{ tableLabel: 'Bulk import preview table' }}
                    />

                    {submitting && (
                        <ProgressBar
                            value={submitProgress}
                            label="Submitting jobs..."
                            description={`${submitProgress}% complete`}
                        />
                    )}

                    {submitResults && (
                        <Alert
                            type={submitResults.failed === 0 ? 'success' : 'warning'}
                            header="Bulk import complete"
                        >
                            <SpaceBetween size="xs">
                                <Box>
                                    <StatusIndicator type="success">
                                        {submitResults.succeeded} succeeded
                                    </StatusIndicator>
                                    {submitResults.failed > 0 && (
                                        <StatusIndicator type="error">
                                            {submitResults.failed} failed
                                        </StatusIndicator>
                                    )}
                                </Box>
                                {submitResults.errors.length > 0 && (
                                    <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                                        {submitResults.errors.map((err, i) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                )}
                            </SpaceBetween>
                        </Alert>
                    )}

                    <SpaceBetween direction="horizontal" size="xs">
                        <Button onClick={handleReset}>Clear</Button>
                        <Button
                            onClick={handleSubmitSelected}
                            variant="primary"
                            loading={submitting}
                            disabled={selectedCount === 0 || submitting}
                        >
                            {submitLabel}
                        </Button>
                        {failedJobs.length > 0 && !submitting && (
                            <Button onClick={handleRetryFailed} iconName="refresh">
                                {`Retry Failed (${failedJobs.length})`}
                            </Button>
                        )}
                    </SpaceBetween>
                </SpaceBetween>
            )}

            {!hasPreview && !fileError && (
                <Box textAlign="center" color="text-body-secondary" padding="l">
                    Upload a CSV file or download the template to get started.
                </Box>
            )}
        </SpaceBetween>
    )
}
