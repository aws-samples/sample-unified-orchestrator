import { useState, useMemo, useEffect, type ReactNode } from 'react'
import Table from '@cloudscape-design/components/table'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Header from '@cloudscape-design/components/header'
import Pagination from '@cloudscape-design/components/pagination'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import Input from '@cloudscape-design/components/input'
import PropertyFilter, {
    type PropertyFilterProps,
} from '@cloudscape-design/components/property-filter'
import Badge from '@cloudscape-design/components/badge'
import Popover from '@cloudscape-design/components/popover'
import type { TableProps } from '@cloudscape-design/components/table'
import type { SyncJob, InstanceHealth } from '../services/api'
import { getInstanceHealth } from '../services/api'
import { formatDate, formatBytes, formatDuration, formatTimeAgo } from '../utils/formatters'

// ── Constants ──

const PAGE_SIZE = 30

type StatusIndicatorType = 'success' | 'error' | 'warning' | 'info' | 'in-progress' | 'pending' | 'stopped'

const STATUS_MAP: Record<string, { type: StatusIndicatorType; label: string }> = {
    COMPLETED: { type: 'success', label: 'Completed' },
    SUCCESS: { type: 'success', label: 'Success' },
    FAILED: { type: 'error', label: 'Failed' },
    ERROR: { type: 'error', label: 'Error' },
    TIMED_OUT: { type: 'error', label: 'Timed Out' },
    RUNNING: { type: 'in-progress', label: 'Running' },
    PROCESSING: { type: 'in-progress', label: 'Processing' },
    PENDING: { type: 'pending', label: 'Pending' },
    QUEUED: { type: 'pending', label: 'Queued' },
    CANCELLED: { type: 'stopped', label: 'Cancelled' },
}

const ACTIVE_STATUSES = new Set(['PENDING', 'QUEUED', 'RUNNING', 'PROCESSING'])
const RETRYABLE_STATUSES = new Set(['FAILED', 'ERROR', 'TIMED_OUT', 'CANCELLED'])

const STATUS_FILTER_OPTIONS = [
    { label: 'Pending', value: 'PENDING' },
    { label: 'Queued', value: 'QUEUED' },
    { label: 'Processing', value: 'PROCESSING' },
    { label: 'Running', value: 'RUNNING' },
    { label: 'Completed', value: 'COMPLETED' },
    { label: 'Failed', value: 'FAILED' },
    { label: 'Cancelled', value: 'CANCELLED' },
]

const FILTERING_PROPERTIES: PropertyFilterProps.FilteringProperty[] = [
    {
        key: 'status',
        propertyLabel: 'Status',
        groupValuesLabel: 'Status values',
        operators: ['=', '!='],
    },
    {
        key: 'jobName',
        propertyLabel: 'Job Name',
        groupValuesLabel: 'Job name values',
        operators: ['=', '!=', ':', '!:'],
    },
    {
        key: 'tags',
        propertyLabel: 'Tags',
        groupValuesLabel: 'Tag values',
        operators: [':', '!:'],
    },
    {
        key: 'account',
        propertyLabel: 'Account',
        groupValuesLabel: 'Account values',
        operators: ['=', '!='],
    },
    {
        key: 'targetRegion',
        propertyLabel: 'Target Region',
        groupValuesLabel: 'Region values',
        operators: ['=', '!='],
    },
]

const STEP_LABELS: Record<string, string> = {
    ValidatePaths: 'Validating Paths',
    CheckAndInstallRsync: 'Checking Rsync',
    RetrieveAndSaveSSHKey: 'Retrieving SSH Key',
    RetrieveCredential: 'Retrieving Credential',
    CheckDiskSpace: 'Checking Disk Space',
    ExecuteRsync: 'Syncing Files',
    ValidateChecksums: 'Validating Checksums',
    Cleanup: 'Cleaning Up',
}

// ── Props ──

interface JobTableProps {
    jobs: SyncJob[]
    loading: boolean
    onUpdateJob: (jobId: string, updates: Partial<SyncJob>) => Promise<SyncJob>
    onDeleteJob: (jobId: string) => Promise<void>
    onRetryJob: (jobId: string) => Promise<void>
    onCancelJob: (jobId: string) => Promise<void>
    onSelectJob: (job: SyncJob, mode: 'clone' | 'delta' | 'logs') => void
    onRefresh: () => void
    onExport?: () => void
}

// ── Sub-components ──

/** Live elapsed timer that ticks every second */
function ElapsedTimer({ startTime }: { startTime: string }) {
    const [, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(id)
    }, [])
    if (!startTime) return <span>Starting...</span>
    const elapsed = Date.now() - new Date(startTime).getTime()
    return <span>{formatDuration(elapsed)}</span>
}

/** Status indicator with optional elapsed timer for active jobs */
function getStatusIndicator(status: string, job?: SyncJob): ReactNode {
    const mapped = STATUS_MAP[status] || { type: 'pending' as StatusIndicatorType, label: status }
    if (ACTIVE_STATUSES.has(status) && job) {
        const startTime = job.startedAt || job.createdAt
        return (
            <StatusIndicator type={mapped.type}>
                {mapped.label} (<ElapsedTimer startTime={startTime} />)
            </StatusIndicator>
        )
    }
    return <StatusIndicator type={mapped.type}>{mapped.label}</StatusIndicator>
}

/** Inline step indicator for active jobs */
function InlineOutput({ job, onExpand }: { job: SyncJob; onExpand: () => void }) {
    const stepName = job.currentStep || job.liveOutputStep
    const label = stepName ? STEP_LABELS[stepName] || stepName : 'Initializing'

    return (
        <Box variant="small" color="text-body-secondary">
            <span
                onClick={onExpand}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') onExpand() }}
                style={{ cursor: 'pointer', fontSize: '11px' }}
            >
                <span
                    style={{
                        display: 'inline-block',
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: '#0972d3',
                        marginRight: '4px',
                    }}
                />
                {label}
            </span>
        </Box>
    )
}

/** Instance health badges for running jobs */
function HealthBadge({ jobId }: { jobId: string }) {
    const [health, setHealth] = useState<InstanceHealth | null>(null)

    useEffect(() => {
        let cancelled = false
        const poll = () => {
            getInstanceHealth(jobId)
                .then((h) => {
                    if (!cancelled) setHealth(h)
                })
                .catch(() => { })
        }
        poll()
        const id = setInterval(poll, 15000)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [jobId])

    if (!health?.metrics) return null

    const cpu = health.metrics.cpuUtilization ?? 0
    const disk = health.metrics.diskUtilization ?? 0
    const mem = health.metrics.memoryUtilization
    const netIn = health.metrics.networkIn
    const netOut = health.metrics.networkOut

    const flagged: Record<string, string> = {}
    if (health.reasons) {
        for (const r of health.reasons) {
            flagged[r.metric] = r.level
        }
    }

    const metricType = (
        metric: string,
        val: number,
        warnThresh?: number,
        errThresh?: number,
    ): StatusIndicatorType => {
        if (flagged[metric] === 'unhealthy') return 'error'
        if (flagged[metric] === 'warning') return 'warning'
        if (errThresh != null && val > errThresh) return 'error'
        if (warnThresh != null && val > warnThresh) return 'warning'
        return 'success'
    }

    return (
        <SpaceBetween size="xxxs">
            <SpaceBetween direction="horizontal" size="xxs">
                <StatusIndicator type={metricType('cpu', cpu, 70, 85)}>
                    CPU {cpu.toFixed(0)}%
                </StatusIndicator>
                <StatusIndicator type={metricType('disk', disk, 85, 95)}>
                    Disk {disk.toFixed(0)}%
                </StatusIndicator>
                {mem != null && (
                    <StatusIndicator type={metricType('memory', mem, 80, 90)}>
                        Mem {mem.toFixed(0)}%
                    </StatusIndicator>
                )}
            </SpaceBetween>
            {(netIn != null || netOut != null) && (
                <SpaceBetween direction="horizontal" size="xxs">
                    {netIn != null && (
                        <StatusIndicator type={metricType('networkIn', netIn)}>
                            Net In: {formatBytes(netIn)}
                        </StatusIndicator>
                    )}
                    {netOut != null && (
                        <StatusIndicator type={metricType('networkOut', netOut)}>
                            Net Out: {formatBytes(netOut)}
                        </StatusIndicator>
                    )}
                </SpaceBetween>
            )}
            {(health.status === 'warning' || health.status === 'unhealthy') && (
                <Box variant="small" color="text-status-warning">
                    {health.status === 'unhealthy' ? 'Unhealthy' : 'Warning'}
                </Box>
            )}
        </SpaceBetween>
    )
}

/** Sync details cell with source/target, paths, and metadata badges */
function SyncDetailsCell({ job }: { job: SyncJob }) {
    const source = job.sourceHost || '—'
    const target = job.targetInstanceId || '—'
    const paths = job.pathPairs || []
    const firstPath = paths[0] || { sourcePath: '', targetPath: '' }
    const extraCount = paths.length > 1 ? paths.length - 1 : 0

    return (
        <SpaceBetween size="xxs">
            <Box variant="small">
                <strong>Source:</strong> {source}:{firstPath.sourcePath}
            </Box>
            <Box variant="small">
                <strong>Target:</strong> {target}:{firstPath.targetPath}
            </Box>
            {extraCount > 0 && (
                <Popover
                    header="All Sync Paths"
                    size="large"
                    triggerType="text"
                    content={
                        <SpaceBetween size="xs">
                            {paths.map((p, i) => (
                                <Box key={i} variant="small">
                                    {p.sourcePath} → {p.targetPath}
                                </Box>
                            ))}
                        </SpaceBetween>
                    }
                >
                    <Box variant="small" color="text-status-info" fontWeight="bold">
                        +{extraCount} more path{extraCount > 1 ? 's' : ''}
                    </Box>
                </Popover>
            )}
            <SpaceBetween direction="horizontal" size="xxs">
                {job.targetAccountAlias && <Badge color="blue">{job.targetAccountAlias}</Badge>}
                {!job.targetAccountAlias && job.targetAccountId && (
                    <Badge color="blue">***{job.targetAccountId.slice(-4)}</Badge>
                )}
                {job.targetRegion && job.targetRegion !== 'us-east-1' && (
                    <Badge color="blue">{job.targetRegion}</Badge>
                )}
                {job.credentialType && <Badge color="grey">{job.credentialType}</Badge>}
                <Badge color="green">
                    {job.operatingSystem === 'Windows'
                        ? 'robocopy'
                        : job.transferEngine || 'rsync'}
                </Badge>
                {job.tags?.map((tag, i) => <Badge key={i}>{tag}</Badge>)}
            </SpaceBetween>
            {(Number(job.retryCount) > 0 || job.retriedFromJobId) && (
                <SpaceBetween direction="horizontal" size="xxs">
                    {Number(job.retryCount) > 0 && (
                        <Badge color="red">Retries: {job.retryCount}</Badge>
                    )}
                    {job.retriedFromJobId && (
                        <Box variant="small" color="text-body-secondary">
                            Retried from: {job.retriedFromJobId}
                        </Box>
                    )}
                </SpaceBetween>
            )}
            {job.lastDeltaCheckAt && (
                <Box variant="small" color="text-body-secondary">
                    Last checked: {formatTimeAgo(job.lastDeltaCheckAt)}
                    {Number(job.lastDeltaCheckNewFiles) > 0
                        ? ` (${job.lastDeltaCheckNewFiles} new file${Number(job.lastDeltaCheckNewFiles) > 1 ? 's' : ''})`
                        : ' (no changes)'}
                </Box>
            )}
        </SpaceBetween>
    )
}

/** Job metrics popover content for completed jobs */
function JobMetrics({ job }: { job: SyncJob }) {
    const isCompleted = job.status === 'COMPLETED' || job.status === 'SUCCESS'
    const isRunning = ACTIVE_STATUSES.has(job.status)

    const duration =
        job.duration ||
        (isCompleted && job.completedAt && job.startedAt
            ? new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()
            : null)

    const elapsed =
        isRunning && job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : null

    const hasMetrics = job.filesTransferred || job.bytesTransferred || duration || elapsed
    if (!hasMetrics) return null

    const activeDuration = duration || elapsed
    const speed =
        job.bytesTransferred && activeDuration
            ? job.bytesTransferred / (activeDuration / 1000)
            : null

    return (
        <Box variant="small" color="text-body-secondary">
            <SpaceBetween size="xxxs">
                {(job.filesTransferred || job.bytesTransferred) && (
                    <span>
                        Files: {job.filesTransferred ?? 0} · Data:{' '}
                        {job.bytesTransferred ? formatBytes(job.bytesTransferred) : '—'}
                    </span>
                )}
                {isCompleted && duration && (
                    <span>
                        Speed: {speed ? `${formatBytes(speed)}/s` : '—'} · Duration:{' '}
                        {formatDuration(duration)}
                    </span>
                )}
                {isRunning && elapsed && (
                    <span>
                        Elapsed: {formatDuration(elapsed)}
                        {speed ? ` · Speed: ${formatBytes(speed)}/s` : ''}
                    </span>
                )}
            </SpaceBetween>
        </Box>
    )
}

// ── Filtering Logic ──

interface FilterToken {
    propertyKey?: string
    operator: string
    value: string
}

interface FilterQuery {
    tokens: FilterToken[]
    operation: 'and' | 'or'
}

/** Evaluate a single filter token against a job */
function matchToken(job: SyncJob, token: FilterToken): boolean {
    const { propertyKey, operator, value } = token
    if (!propertyKey || !value) return true

    const lowerValue = value.toLowerCase()

    if (propertyKey === 'status') {
        const jobStatus = (job.status || '').toLowerCase()
        if (operator === '=') return jobStatus === lowerValue
        if (operator === '!=') return jobStatus !== lowerValue
        return true
    }

    if (propertyKey === 'jobName') {
        const name = (job.jobName || job.jobId || '').toLowerCase()
        if (operator === '=') return name === lowerValue
        if (operator === '!=') return name !== lowerValue
        if (operator === ':') return name.includes(lowerValue)
        if (operator === '!:') return !name.includes(lowerValue)
        return true
    }

    if (propertyKey === 'tags') {
        const jobTags = (job.tags || []).map((t) => t.toLowerCase())
        if (operator === ':') return jobTags.some((t) => t.includes(lowerValue))
        if (operator === '!:') return !jobTags.some((t) => t.includes(lowerValue))
        return true
    }

    if (propertyKey === 'account') {
        const alias = (job.targetAccountAlias || '').toLowerCase()
        const acctId = (job.targetAccountId || '').toLowerCase()
        const matches = alias === lowerValue || acctId === lowerValue
        if (operator === '=') return matches
        if (operator === '!=') return !matches
        return true
    }

    if (propertyKey === 'targetRegion') {
        const region = (job.targetRegion || '').toLowerCase()
        if (operator === '=') return region === lowerValue
        if (operator === '!=') return region !== lowerValue
        return true
    }

    return true
}

/** Filter jobs using PropertyFilter query tokens. AND across property keys, OR within same key. */
function filterJobsByQuery(jobs: SyncJob[], query: FilterQuery): SyncJob[] {
    const { tokens } = query
    if (!tokens || tokens.length === 0) return jobs

    const grouped: Record<string, FilterToken[]> = {}
    for (const token of tokens) {
        const key = token.propertyKey || '__freetext__'
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(token)
    }

    return jobs.filter((job) =>
        Object.values(grouped).every((groupTokens) =>
            groupTokens.some((token) => matchToken(job, token)),
        ),
    )
}

// ── Main Component ──

export default function JobTable({
    jobs = [],
    loading = false,
    onUpdateJob,
    onDeleteJob,
    onRetryJob,
    onCancelJob,
    onSelectJob,
    onRefresh,
    onExport,
}: JobTableProps) {
    const [filterQuery, setFilterQuery] = useState<FilterQuery>({
        tokens: [],
        operation: 'and',
    })
    const [currentPage, setCurrentPage] = useState(1)
    const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<SyncJob> | null>(
        null,
    )
    const [sortingDescending, setSortingDescending] = useState(false)
    const [editingJobId, setEditingJobId] = useState<string | null>(null)
    const [editName, setEditName] = useState('')

    function startEditing(job: SyncJob) {
        setEditingJobId(job.jobId)
        setEditName(job.jobName || '')
    }

    function cancelEditing() {
        setEditingJobId(null)
        setEditName('')
    }

    async function saveJobName(jobId: string) {
        if (onUpdateJob && editName.trim()) {
            await onUpdateJob(jobId, { jobName: editName.trim() })
        }
        setEditingJobId(null)
        setEditName('')
    }

    // ── Column Definitions ──

    const COLUMN_DEFINITIONS: TableProps.ColumnDefinition<SyncJob>[] = useMemo(
        () => [
            {
                id: 'jobName',
                header: 'Job Name',
                sortingField: 'jobName',
                cell: (job: SyncJob) => {
                    if (editingJobId === job.jobId) {
                        return (
                            <SpaceBetween direction="horizontal" size="xs">
                                <Input
                                    value={editName}
                                    onChange={({ detail }) => setEditName(detail.value)}
                                    ariaLabel="Edit job name"
                                    autoFocus
                                />
                                <Button
                                    iconName="check"
                                    variant="icon"
                                    ariaLabel="Save"
                                    onClick={() => saveJobName(job.jobId)}
                                />
                                <Button
                                    iconName="close"
                                    variant="icon"
                                    ariaLabel="Cancel"
                                    onClick={cancelEditing}
                                />
                            </SpaceBetween>
                        )
                    }
                    return (
                        <Button
                            variant="inline-link"
                            ariaLabel={`Edit name for ${job.jobName || job.jobId}`}
                            onClick={() => startEditing(job)}
                        >
                            {job.jobName || job.jobId}
                        </Button>
                    )
                },
                minWidth: 180,
            },
            {
                id: 'jobId',
                header: 'Job ID',
                cell: (job: SyncJob) => {
                    const fullId = job.jobId || '—'
                    return (
                        <Popover
                            dismissButton={false}
                            position="top"
                            size="small"
                            triggerType="custom"
                            content={
                                <Box variant="small" padding="xxs">
                                    Click to copy
                                </Box>
                            }
                        >
                            <Box
                                variant="small"
                                color="text-body-secondary"
                                data-testid={`job-id-${fullId}`}
                            >
                                <span
                                    role="button"
                                    tabIndex={0}
                                    style={{
                                        fontFamily: 'monospace',
                                        fontSize: '11px',
                                        cursor: 'pointer',
                                        wordBreak: 'break-all',
                                    }}
                                    onClick={() => navigator.clipboard?.writeText(fullId)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') navigator.clipboard?.writeText(fullId)
                                    }}
                                >
                                    {fullId}
                                </span>
                            </Box>
                        </Popover>
                    )
                },
                minWidth: 140,
            },
            {
                id: 'status',
                header: 'Status',
                sortingField: 'status',
                cell: (job: SyncJob) => getStatusIndicator(job.status, job),
                minWidth: 120,
            },
            {
                id: 'progress',
                header: 'Progress',
                cell: (job: SyncJob) => {
                    const pct = job.progress ?? 0
                    const isActive = ACTIVE_STATUSES.has(job.status)
                    const isCompleted = job.status === 'COMPLETED' || job.status === 'SUCCESS'
                    const isFailed = job.status === 'FAILED' || job.status === 'ERROR'
                    const isCancelled = job.status === 'CANCELLED'
                    const isTimedOut = job.status === 'TIMED_OUT'

                    if ((isCancelled || isTimedOut) && pct === 0) {
                        return (
                            <Box variant="small" color="text-body-secondary">
                                —
                            </Box>
                        )
                    }

                    if (isActive) {
                        return (
                            <SpaceBetween size="xxs">
                                <InlineOutput
                                    job={job}
                                    onExpand={() => onSelectJob?.(job, 'logs')}
                                />
                                <HealthBadge jobId={job.jobId} />
                            </SpaceBetween>
                        )
                    }

                    return (
                        <SpaceBetween size="xxs">
                            <ProgressBar
                                value={isCompleted ? 100 : pct}
                                status={
                                    isCompleted ? 'success' : isFailed ? 'error' : undefined
                                }
                                ariaLabel={`Progress for ${job.jobName || job.jobId}`}
                            />
                            {isCompleted &&
                                (job.filesTransferred ||
                                    job.bytesTransferred ||
                                    job.duration ||
                                    (job.completedAt && job.startedAt)) && (
                                    <Popover
                                        dismissButton={false}
                                        position="bottom"
                                        size="large"
                                        triggerType="text"
                                        content={<JobMetrics job={job} />}
                                    >
                                        <Box variant="small" color="text-status-info">
                                            View metrics
                                        </Box>
                                    </Popover>
                                )}
                        </SpaceBetween>
                    )
                },
                minWidth: 200,
            },
            {
                id: 'syncDetails',
                header: 'Sync Details',
                cell: (job: SyncJob) => <SyncDetailsCell job={job} />,
                minWidth: 280,
            },
            {
                id: 'created',
                header: 'Created',
                sortingField: 'createdAt',
                cell: (job: SyncJob) => (
                    <SpaceBetween size="xxs">
                        <Box variant="small">{formatDate(job.createdAt)}</Box>
                        {job.updatedAt && (
                            <Box variant="small" color="text-body-secondary">
                                Updated: {formatDate(job.updatedAt)}
                            </Box>
                        )}
                    </SpaceBetween>
                ),
                minWidth: 150,
            },
            {
                id: 'actions',
                header: 'Actions',
                cell: (job: SyncJob) => {
                    const isActive = ACTIVE_STATUSES.has(job.status)
                    const isRetryable = RETRYABLE_STATUSES.has(job.status)

                    return (
                        <SpaceBetween direction="horizontal" size="xxs">
                            <Popover
                                dismissButton={false}
                                position="top"
                                size="small"
                                triggerType="custom"
                                content={
                                    <Box variant="small" padding="xxs">
                                        View sync logs
                                    </Box>
                                }
                            >
                                <Button
                                    variant="icon"
                                    iconName="file"
                                    onClick={() => onSelectJob?.(job, 'logs')}
                                    ariaLabel="View logs"
                                />
                            </Popover>
                            <Popover
                                dismissButton={false}
                                position="top"
                                size="small"
                                triggerType="custom"
                                content={
                                    <Box variant="small" padding="xxs">
                                        Compare source and target
                                    </Box>
                                }
                            >
                                <Button
                                    variant="icon"
                                    iconName="search"
                                    onClick={() => onSelectJob?.(job, 'delta')}
                                    disabled={isActive}
                                    ariaLabel="Delta check"
                                />
                            </Popover>
                            <Popover
                                dismissButton={false}
                                position="top"
                                size="small"
                                triggerType="custom"
                                content={
                                    <Box variant="small" padding="xxs">
                                        Clone job settings
                                    </Box>
                                }
                            >
                                <Button
                                    variant="icon"
                                    iconName="copy"
                                    onClick={() => onSelectJob?.(job, 'clone')}
                                    ariaLabel="Clone job"
                                />
                            </Popover>
                            {isRetryable && (
                                <Popover
                                    dismissButton={false}
                                    position="top"
                                    size="small"
                                    triggerType="custom"
                                    content={
                                        <Box variant="small" padding="xxs">
                                            Retry failed job
                                        </Box>
                                    }
                                >
                                    <Button
                                        variant="icon"
                                        iconName="redo"
                                        onClick={() => onRetryJob?.(job.jobId)}
                                        ariaLabel="Retry job"
                                    />
                                </Popover>
                            )}
                            {isActive && (
                                <Popover
                                    dismissButton={false}
                                    position="top"
                                    size="small"
                                    triggerType="custom"
                                    content={
                                        <Box variant="small" padding="xxs">
                                            Cancel running job
                                        </Box>
                                    }
                                >
                                    <Button
                                        variant="icon"
                                        iconName="close"
                                        onClick={() => onCancelJob?.(job.jobId)}
                                        ariaLabel="Cancel job"
                                    />
                                </Popover>
                            )}
                            <Popover
                                dismissButton={false}
                                position="top"
                                size="small"
                                triggerType="custom"
                                content={
                                    <Box variant="small" padding="xxs">
                                        Delete job permanently
                                    </Box>
                                }
                            >
                                <Button
                                    variant="icon"
                                    iconName="remove"
                                    onClick={() => onDeleteJob?.(job.jobId)}
                                    disabled={isActive}
                                    ariaLabel="Delete job"
                                />
                            </Popover>
                        </SpaceBetween>
                    )
                },
                minWidth: 200,
            },
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [editingJobId, editName],
    )

    // ── Dynamic filter options from job data ──

    const filteringOptions = useMemo(() => {
        const options: PropertyFilterProps.FilteringOption[] = []

        STATUS_FILTER_OPTIONS.forEach(({ label, value }) => {
            options.push({ propertyKey: 'status', value, label })
        })

        const seenAccounts = new Set<string>()
        jobs.forEach((job) => {
            const alias = job.targetAccountAlias || ''
            const acctId = job.targetAccountId || ''
            if (alias && !seenAccounts.has(alias)) {
                seenAccounts.add(alias)
                options.push({ propertyKey: 'account', value: alias, label: alias })
            }
            if (acctId && !seenAccounts.has(acctId)) {
                seenAccounts.add(acctId)
                options.push({
                    propertyKey: 'account',
                    value: acctId,
                    label: `***${acctId.slice(-4)}`,
                })
            }
        })

        const seenTags = new Set<string>()
        jobs.forEach((job) => {
            ; (job.tags || []).forEach((tag) => {
                if (tag && !seenTags.has(tag)) {
                    seenTags.add(tag)
                    options.push({ propertyKey: 'tags', value: tag, label: tag })
                }
            })
        })

        return options
    }, [jobs])

    // ── Filter, Sort, Paginate ──

    const filteredJobs = useMemo(
        () => filterJobsByQuery(jobs, filterQuery),
        [jobs, filterQuery],
    )

    const sortedJobs = useMemo(() => {
        if (!sortingColumn) return filteredJobs
        const field = sortingColumn.sortingField as keyof SyncJob | undefined
        if (!field) return filteredJobs
        const sorted = [...filteredJobs].sort((a, b) => {
            const aVal = String(a[field] ?? '').toLowerCase()
            const bVal = String(b[field] ?? '').toLowerCase()
            return aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        })
        return sortingDescending ? sorted.reverse() : sorted
    }, [filteredJobs, sortingColumn, sortingDescending])

    const pageCount = Math.max(1, Math.ceil(sortedJobs.length / PAGE_SIZE))
    const safePage = Math.min(currentPage, pageCount)
    const paginatedJobs = sortedJobs.slice(
        (safePage - 1) * PAGE_SIZE,
        safePage * PAGE_SIZE,
    )

    // ── Render ──

    return (
        <Table
            columnDefinitions={COLUMN_DEFINITIONS}
            items={paginatedJobs}
            loading={loading}
            loadingText="Loading jobs..."
            sortingColumn={sortingColumn ?? undefined}
            sortingDescending={sortingDescending}
            onSortingChange={({ detail }) => {
                setSortingColumn(detail.sortingColumn)
                setSortingDescending(detail.isDescending ?? false)
            }}
            header={
                <Header
                    counter={`(${filteredJobs.length})`}
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            {onExport && (
                                <Button
                                    iconName="download"
                                    onClick={onExport}
                                    ariaLabel="Export jobs"
                                >
                                    Export
                                </Button>
                            )}
                            <Button
                                iconName="refresh"
                                ariaLabel="Refresh jobs"
                                onClick={() => onRefresh?.()}
                            />
                        </SpaceBetween>
                    }
                >
                    Sync Jobs
                </Header>
            }
            filter={
                <PropertyFilter
                    query={filterQuery}
                    onChange={({ detail }) => {
                        setFilterQuery(detail as FilterQuery)
                        setCurrentPage(1)
                    }}
                    filteringProperties={FILTERING_PROPERTIES}
                    filteringOptions={filteringOptions}
                    i18nStrings={{
                        filteringAriaLabel: 'Filter sync jobs',
                        filteringPlaceholder: 'Filter jobs by property or value',
                        groupValuesText: 'Values',
                        groupPropertiesText: 'Properties',
                        operatorsText: 'Operators',
                        operationAndText: 'and',
                        operationOrText: 'or',
                        operatorLessText: 'Less than',
                        operatorLessOrEqualText: 'Less than or equal',
                        operatorGreaterText: 'Greater than',
                        operatorGreaterOrEqualText: 'Greater than or equal',
                        operatorContainsText: 'Contains',
                        operatorDoesNotContainText: 'Does not contain',
                        operatorEqualsText: 'Equals',
                        operatorDoesNotEqualText: 'Does not equal',
                        editTokenHeader: 'Edit filter',
                        propertyText: 'Property',
                        operatorText: 'Operator',
                        valueText: 'Value',
                        cancelActionText: 'Cancel',
                        applyActionText: 'Apply',
                        clearFiltersText: 'Clear filters',
                        removeTokenButtonAriaLabel: (token) =>
                            `Remove filter, ${token.propertyKey} ${token.operator} ${token.value}`,
                        enteredTextLabel: (text) => `Use: "${text}"`,
                    }}
                />
            }
            pagination={
                <Pagination
                    currentPageIndex={safePage}
                    pagesCount={pageCount}
                    ariaLabels={{
                        nextPageLabel: 'Next page',
                        previousPageLabel: 'Previous page',
                        pageLabel: (pageNumber) => `Page ${pageNumber}`,
                    }}
                    onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
                />
            }
            empty={
                <Box textAlign="center" color="inherit" padding="l">
                    <b>No sync jobs</b>
                    <Box variant="p" color="inherit">
                        Create a sync job to get started.
                    </Box>
                </Box>
            }
            ariaLabels={{
                tableLabel: 'Sync jobs table',
                allItemsSelectionLabel: () => 'Select all jobs',
                itemSelectionLabel: (_data, row) =>
                    `Select ${row.jobName || row.jobId}`,
            }}
            variant="full-page"
            stickyHeader
            resizableColumns
        />
    )
}

export {
    STATUS_MAP,
    ACTIVE_STATUSES,
    RETRYABLE_STATUSES,
    STATUS_FILTER_OPTIONS,
    FILTERING_PROPERTIES,
    getStatusIndicator,
    JobMetrics,
    matchToken,
    filterJobsByQuery,
}
