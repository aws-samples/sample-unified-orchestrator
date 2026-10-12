import { useState } from 'react'
import SpaceBetween from '@cloudscape-design/components/space-between'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Select from '@cloudscape-design/components/select'
import Button from '@cloudscape-design/components/button'
import Checkbox from '@cloudscape-design/components/checkbox'
import RadioGroup from '@cloudscape-design/components/radio-group'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Badge from '@cloudscape-design/components/badge'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import type { SelectProps } from '@cloudscape-design/components/select'
import type { CreateJobParams, SyncJob, InventoryServer, InventorySearchResult } from '../services/api'
import { searchInventory, runValidation, getValidationResults, getSyncStatus } from '../services/api'

interface ExpressModeProps {
    onCreateJob: (config: CreateJobParams) => Promise<SyncJob>
    jobs?: SyncJob[]
}

const BANDWIDTH_OPTIONS: SelectProps.Option[] = [
    { label: 'Unlimited', value: '' },
    { label: '10 MB/s', value: '10000' },
    { label: '50 MB/s', value: '50000' },
    { label: '100 MB/s', value: '100000' },
    { label: '500 MB/s', value: '500000' },
]

interface MatchSummary {
    matchedCount: number
    totalSources: number
    extraTargets: InventoryServer[]
    extraTargetCount: number
}

function computeMatchSummary(sources: InventoryServer[], targets: InventoryServer[]): MatchSummary {
    const matchedCount = sources.filter(s => targets.some(t => t.serverName === s.serverName)).length
    const totalSources = sources.length
    const extraTargets = targets.filter(t => !sources.some(s => s.serverName === t.serverName))
    return { matchedCount, totalSources, extraTargets, extraTargetCount: extraTargets.length }
}

function buildExpressPayload(
    source: InventoryServer,
    target: InventoryServer,
    selectedPaths: string[],
    options: { bandwidthLimit?: string; excludePatterns?: string; preserveACL: boolean; preserveXattrs: boolean; tags?: string[] }
): CreateJobParams {
    let transferEngine = source.transferEngine || 'rsync'
    if (source.operatingSystem === 'Windows') transferEngine = 'rsync'

    const payload: CreateJobParams = {
        jobName: `${source.serverName} → ${target.serverName}`,
        operatingSystem: source.operatingSystem,
        sourceHost: source.hostIp,
        targetInstanceId: target.targetInstanceId || '',
        sshKeyArn: source.sshKeyArn || '',
        pathPairs: selectedPaths.map(p => ({ sourcePath: p, targetPath: p })),
        credentialType: source.credentialType || 'secretsmanager',
        transferEngine,
    }

    if (target.targetAccountId) payload.targetAccountId = target.targetAccountId
    // Pass target region from inventory data if available
    if ((target as unknown as Record<string, unknown>).region) {
        payload.targetRegion = (target as unknown as Record<string, unknown>).region as string
    }
    if (options.bandwidthLimit) payload.bandwidthLimit = options.bandwidthLimit
    if (options.excludePatterns) payload.excludePatterns = options.excludePatterns
    if (source.operatingSystem !== 'Windows' && transferEngine !== 'rclone') {
        payload.preserveACL = options.preserveACL
        payload.preserveXattrs = options.preserveXattrs
    }
    if (options.tags && options.tags.length > 0) payload.tags = options.tags

    return payload
}

// Normalize a path by removing trailing slash (unless path is "/")
function normalizePath(p: string): string {
    return (p && p.length > 1 && p.endsWith('/')) ? p.slice(0, -1) : p
}

interface ValidateAllEntry {
    serverName: string
    sourceIp: string
    targetInstanceId: string
    status: 'passed' | 'failed' | 'error'
    results: Record<string, unknown> | null
    error: string | null
}

interface SyncJobEntry {
    jobId: string | null
    serverName: string
    status: string
}

export default function ExpressMode({ onCreateJob, jobs }: ExpressModeProps) {
    // Search state
    const [motsId, setMotsId] = useState('')
    const [searching, setSearching] = useState(false)
    const [inventoryData, setInventoryData] = useState<InventorySearchResult | null>(null)
    const [searchError, setSearchError] = useState('')
    const [noResults, setNoResults] = useState(false)

    // Server selection state
    const [selectedSource, setSelectedSource] = useState<InventoryServer | null>(null)
    const [selectedTarget, setSelectedTarget] = useState<InventoryServer | null>(null)

    // Path selection state
    const [selectedPaths, setSelectedPaths] = useState<string[]>([])

    // Options state
    const [bandwidthLimit, setBandwidthLimit] = useState<SelectProps.Option>(BANDWIDTH_OPTIONS[0])
    const [excludePatterns, setExcludePatterns] = useState('')
    const [preserveACL, setPreserveACL] = useState(true)
    const [preserveXattrs, setPreserveXattrs] = useState(true)
    const [jobTags, setJobTags] = useState('')

    // Execution schedule state
    const [executionMode, setExecutionMode] = useState('now')
    const [scheduleDate, setScheduleDate] = useState('')
    const [scheduleTime, setScheduleTime] = useState('')
    const [recurringStartDate, setRecurringStartDate] = useState('')
    const [recurringStartTime, setRecurringStartTime] = useState('02:00')
    const [recurringDays, setRecurringDays] = useState('7')
    const [timezone, setTimezone] = useState('utc')

    // Submission state
    const [submitting, setSubmitting] = useState(false)
    const [validating, setValidating] = useState(false)
    const [submitError, setSubmitError] = useState('')
    const [submitSuccess, setSubmitSuccess] = useState('')

    // Conflict guard state
    const [conflictWarning, setConflictWarning] = useState<string | null>(null)

    // Validate All state
    const [validateAllStatus, setValidateAllStatus] = useState<'idle' | 'running' | 'done'>('idle')
    const [validateAllProgress, setValidateAllProgress] = useState({ completed: 0, total: 0 })
    const [validateAllResults, setValidateAllResults] = useState<ValidateAllEntry[]>([])

    // Sync All state
    const [syncAllStatus, setSyncAllStatus] = useState<'idle' | 'submitting' | 'polling' | 'done'>('idle')
    const [syncAllProgress, setSyncAllProgress] = useState({ submitted: 0, total: 0, succeeded: 0, failed: 0 })
    const [syncAllJobs, setSyncAllJobs] = useState<SyncJobEntry[]>([])

    const handleSearch = async () => {
        const trimmed = motsId.trim()
        if (!trimmed) return
        setSearching(true)
        setSearchError('')
        setNoResults(false)
        setInventoryData(null)
        setSelectedSource(null)
        setSelectedTarget(null)
        setSelectedPaths([])
        setValidateAllStatus('idle')
        setValidateAllResults([])
        setSyncAllStatus('idle')
        setSyncAllJobs([])

        try {
            const data = await searchInventory(trimmed)
            if (data.sources.length === 0 && data.targets.length === 0) {
                setNoResults(true)
            } else {
                setInventoryData(data)
            }
        } catch (err) {
            setSearchError((err as Error).message || 'Search failed')
        } finally {
            setSearching(false)
        }
    }

    const handleSourceChange = ({ detail }: { detail: { selectedOption: SelectProps.Option } }) => {
        const sourceId = detail.selectedOption?.value
        if (!sourceId || !inventoryData) return
        const source = inventoryData.sources.find(s => s.serverId === sourceId) || null
        setSelectedSource(source)
        if (source) {
            const matched = inventoryData.targets.find(t => t.serverName === source.serverName)
            if (matched) setSelectedTarget(matched)
            setSelectedPaths(source.syncPaths || [])
        }
    }

    const handleTargetChange = ({ detail }: { detail: { selectedOption: SelectProps.Option } }) => {
        const targetId = detail.selectedOption?.value
        if (!targetId || !inventoryData) return
        setSelectedTarget(inventoryData.targets.find(t => t.serverId === targetId) || null)
    }

    const togglePath = (path: string, checked: boolean) => {
        setSelectedPaths(prev => checked ? [...prev, path] : prev.filter(p => p !== path))
    }

    const checkConflict = (targetInstanceId: string, pathPairs: Array<{ sourcePath: string; targetPath: string }>): boolean => {
        const ACTIVE_STATUSES = new Set(['PENDING', 'QUEUED', 'RUNNING', 'PROCESSING'])
        const activeJobs = (jobs || []).filter(
            j => ACTIVE_STATUSES.has(j.status) && j.targetInstanceId === targetInstanceId
        )
        const proposedPaths = pathPairs.map(pp => ({
            source: normalizePath(pp.sourcePath),
            target: normalizePath(pp.targetPath),
        }))
        const overlappingJobIds: string[] = []
        for (const job of activeJobs) {
            const jobPaths = (job.pathPairs || []).map(pp => ({
                source: normalizePath(pp.sourcePath),
                target: normalizePath(pp.targetPath),
            }))
            const hasOverlap = proposedPaths.some(pp =>
                jobPaths.some(jp => jp.source === pp.source && jp.target === pp.target)
            )
            if (hasOverlap) overlappingJobIds.push(job.jobId)
        }
        if (overlappingJobIds.length > 0) {
            setConflictWarning(`Sync in progress with overlapping paths. Active job(s): ${overlappingJobIds.join(', ')}`)
            return true
        }
        setConflictWarning(null)
        return false
    }

    const handleSubmit = async () => {
        if (!selectedSource || !selectedTarget || selectedPaths.length === 0) return
        const pathPairs = selectedPaths.map(p => ({ sourcePath: p, targetPath: p }))
        if (checkConflict(selectedTarget.targetInstanceId || '', pathPairs)) return

        setSubmitting(true)
        setSubmitError('')
        setSubmitSuccess('')

        try {
            const tagsArray = jobTags.trim() ? jobTags.split(',').map(t => t.trim()).filter(Boolean) : []
            const options = {
                bandwidthLimit: bandwidthLimit.value || undefined,
                excludePatterns: excludePatterns || undefined,
                preserveACL,
                preserveXattrs,
                tags: tagsArray.length > 0 ? tagsArray : undefined,
            }
            const payload = buildExpressPayload(selectedSource, selectedTarget, selectedPaths, options)

            if (executionMode === 'once') {
                payload.schedule = { type: 'once', date: scheduleDate, time: scheduleTime, timezone }
            } else if (executionMode === 'recurring') {
                payload.schedule = {
                    type: 'recurring',
                    startDate: recurringStartDate,
                    startTime: recurringStartTime,
                    days: parseInt(recurringDays, 10),
                    timezone,
                }
            }

            await onCreateJob(payload)
            setSubmitSuccess(`Sync job created: ${selectedSource.serverName} → ${selectedTarget.serverName}`)
        } catch (err) {
            setSubmitError((err as Error).message || 'Failed to create job')
        } finally {
            setSubmitting(false)
        }
    }

    const handleValidate = async () => {
        if (!selectedSource || !selectedTarget || selectedPaths.length === 0) return
        setValidating(true)
        setSubmitError('')

        try {
            const payload: Record<string, unknown> = {
                jobName: `${selectedSource.serverName} → ${selectedTarget.serverName}`,
                sourceHost: selectedSource.hostIp,
                targetInstanceId: selectedTarget.targetInstanceId,
                sshKeyArn: selectedSource.sshKeyArn,
                pathPairs: selectedPaths.map(p => ({ sourcePath: p, targetPath: p })),
                operatingSystem: selectedSource.operatingSystem || 'Linux',
                credentialType: selectedSource.credentialType || 'secretsmanager',
                _validate: true,
            }
            if (selectedTarget.targetAccountId) payload.targetAccountId = selectedTarget.targetAccountId
            await onCreateJob(payload as unknown as CreateJobParams)
            setSubmitSuccess('Validation started')
        } catch (err) {
            setSubmitError((err as Error).message || 'Validation failed')
        } finally {
            setValidating(false)
        }
    }

    const handleValidateAll = async () => {
        if (!inventoryData) return
        const { sources, targets } = inventoryData
        const matched: Array<{ source: InventoryServer; target: InventoryServer }> = []
        sources.forEach(source => {
            const target = targets.find(t => t.serverName === source.serverName)
            if (target) matched.push({ source, target })
        })
        if (matched.length === 0) return

        setValidateAllStatus('running')
        setValidateAllProgress({ completed: 0, total: matched.length })
        setValidateAllResults([])

        const serverResults: ValidateAllEntry[] = []

        for (let i = 0; i < matched.length; i++) {
            const { source, target } = matched[i]
            try {
                const payload: Record<string, unknown> = {
                    sourceHost: source.hostIp,
                    targetInstanceId: target.targetInstanceId,
                    sshKeyArn: source.sshKeyArn,
                    pathPairs: (source.syncPaths || []).map(p => ({ sourcePath: p, targetPath: p })),
                    operatingSystem: source.operatingSystem || 'Linux',
                }
                if (target.targetAccountId) payload.targetAccountId = target.targetAccountId

                const data = await runValidation(payload)
                const params: Record<string, string> = {}
                if (data.ssmCommandId) params.ssmCommandId = data.ssmCommandId
                if (target.targetInstanceId) params.instanceId = target.targetInstanceId
                if (target.targetAccountId) params.targetAccountId = target.targetAccountId

                let result = null
                for (let attempt = 0; attempt < 30; attempt++) {
                    await new Promise(r => setTimeout(r, 5000))
                    result = await getValidationResults(data.validationId, params)
                    if (result.status === 'COMPLETED' || result.status === 'FAILED') break
                }

                if (!result || (result.status !== 'COMPLETED' && result.status !== 'FAILED')) {
                    serverResults.push({ serverName: source.serverName, sourceIp: source.hostIp, targetInstanceId: target.targetInstanceId || '', status: 'error', results: null, error: 'Validation timed out' })
                } else {
                    const connStatus = (result.results as Record<string, unknown>)?.connectivity_status || 'UNKNOWN'
                    const spaceStatus = (result.results as Record<string, unknown>)?.space_check_status || 'UNKNOWN'
                    const isPassed = connStatus === 'SUCCESS' && spaceStatus === 'SUFFICIENT'
                    serverResults.push({
                        serverName: source.serverName,
                        sourceIp: source.hostIp,
                        targetInstanceId: target.targetInstanceId || '',
                        status: result.status === 'COMPLETED' && isPassed ? 'passed' : 'failed',
                        results: (result.results || null) as Record<string, unknown> | null,
                        error: null,
                    })
                }
            } catch (error) {
                serverResults.push({ serverName: source.serverName, sourceIp: source.hostIp, targetInstanceId: target.targetInstanceId || '', status: 'error', results: null, error: (error as Error).message || 'Validation failed' })
            }
            setValidateAllProgress({ completed: i + 1, total: matched.length })
            setValidateAllResults([...serverResults])
        }
        setValidateAllStatus('done')
    }

    const handleSyncAll = async () => {
        if (!inventoryData) return
        const { sources, targets } = inventoryData
        const passedServers = validateAllResults.filter(r => r.status === 'passed')
        if (passedServers.length === 0) return

        const matched: Array<{ source: InventoryServer; target: InventoryServer }> = []
        passedServers.forEach(result => {
            const source = sources.find(s => s.serverName === result.serverName)
            const target = targets.find(t => t.serverName === result.serverName)
            if (source && target) matched.push({ source, target })
        })
        if (matched.length === 0) return

        setSyncAllStatus('submitting')
        setSyncAllProgress({ submitted: 0, total: matched.length, succeeded: 0, failed: 0 })
        setSyncAllJobs([])

        const tagsArray = jobTags.trim() ? jobTags.split(',').map(t => t.trim()).filter(Boolean) : []
        const options = {
            bandwidthLimit: bandwidthLimit.value || undefined,
            excludePatterns: excludePatterns || undefined,
            preserveACL,
            preserveXattrs,
            tags: tagsArray.length > 0 ? tagsArray : undefined,
        }

        let succeeded = 0
        let failed = 0
        const jobEntries: SyncJobEntry[] = []

        for (let i = 0; i < matched.length; i++) {
            const { source, target } = matched[i]
            const allPaths = source.syncPaths || []
            const payload = buildExpressPayload(source, target, allPaths, options)

            try {
                const data = await onCreateJob(payload)
                succeeded++
                jobEntries.push({ jobId: data.jobId, serverName: source.serverName, status: 'QUEUED' })
            } catch {
                failed++
                jobEntries.push({ jobId: null, serverName: source.serverName, status: 'SUBMIT_FAILED' })
            }
            setSyncAllProgress({ submitted: i + 1, total: matched.length, succeeded, failed })
            setSyncAllJobs([...jobEntries])
        }

        // Poll submitted jobs for completion
        const submittedJobs = jobEntries.filter(j => j.jobId)
        if (submittedJobs.length > 0) {
            setSyncAllStatus('polling')
            const allEntries = [...jobEntries]

            const poll = async () => {
                let doneCount = 0
                const total = submittedJobs.length
                for (const entry of allEntries) {
                    if (!entry.jobId) continue
                    if (entry.status === 'COMPLETED' || entry.status === 'FAILED') { doneCount++; continue }
                    try {
                        const data = await getSyncStatus(entry.jobId)
                        entry.status = data.status
                        if (data.status === 'COMPLETED' || data.status === 'FAILED') doneCount++
                    } catch { /* retry on next interval */ }
                }
                setSyncAllJobs([...allEntries])
                const succeededCount = allEntries.filter(j => j.status === 'COMPLETED').length
                const failedJobCount = allEntries.filter(j => j.status === 'FAILED' || j.status === 'SUBMIT_FAILED').length
                setSyncAllProgress(prev => ({ ...prev, succeeded: succeededCount, failed: failedJobCount }))
                if (doneCount < total) {
                    setTimeout(poll, 5000)
                } else {
                    setSyncAllStatus('done')
                }
            }
            setTimeout(poll, 5000)
        } else {
            setSyncAllStatus('done')
        }
    }

    // Dropdown options
    const sourceOptions: SelectProps.Option[] = inventoryData?.sources.map(s => ({
        label: `${s.serverName} (${s.hostIp})`,
        value: s.serverId,
    })) || []

    const targetOptions: SelectProps.Option[] = inventoryData?.targets.map(t => ({
        label: `${t.serverName} (${t.targetInstanceId})`,
        value: t.serverId,
    })) || []

    const sourceSelectedOption: SelectProps.Option | null = selectedSource
        ? { label: `${selectedSource.serverName} (${selectedSource.hostIp})`, value: selectedSource.serverId }
        : null

    const targetSelectedOption: SelectProps.Option | null = selectedTarget
        ? { label: `${selectedTarget.serverName} (${selectedTarget.targetInstanceId})`, value: selectedTarget.serverId }
        : null

    const matchSummary = inventoryData ? computeMatchSummary(inventoryData.sources, inventoryData.targets) : null
    const isLinux = selectedSource && selectedSource.operatingSystem !== 'Windows'
    const canSubmit = selectedSource && selectedTarget && selectedPaths.length > 0 && !submitting

    const allSourcesMatched = matchSummary && matchSummary.matchedCount === matchSummary.totalSources && matchSummary.totalSources > 0
    const validateAllRunning = validateAllStatus === 'running'

    const passedCount = validateAllResults.filter(r => r.status === 'passed').length
    const failedCount = validateAllResults.filter(r => r.status === 'failed').length
    const erroredCount = validateAllResults.filter(r => r.status === 'error').length
    const totalValidated = validateAllResults.length

    const showSyncAll = validateAllStatus === 'done' && passedCount > 0
    const syncAllLabel = passedCount === totalValidated ? 'Sync All' : `Sync Passed (${passedCount} of ${totalValidated})`

    const syncAllTerminalCount = syncAllJobs.filter(j => j.status === 'COMPLETED' || j.status === 'FAILED' || j.status === 'SUBMIT_FAILED').length
    const syncAllPct = syncAllProgress.total > 0
        ? (syncAllStatus === 'submitting'
            ? Math.round((syncAllProgress.submitted / syncAllProgress.total) * 100)
            : Math.round((syncAllTerminalCount / syncAllProgress.total) * 100))
        : 0

    return (
        <SpaceBetween size="l">
            {/* MOTSID Search */}
            <FormField label="MOTSID" description="Enter the application MOTSID to find source and target servers">
                <SpaceBetween direction="horizontal" size="xs">
                    <Input
                        value={motsId}
                        onChange={({ detail }) => setMotsId(detail.value)}
                        placeholder="e.g. 230095"
                        onKeyDown={({ detail }) => { if (detail.key === 'Enter') handleSearch() }}
                        ariaLabel="MOTSID search input"
                    />
                    <Button onClick={handleSearch} loading={searching} disabled={!motsId.trim()} ariaLabel="Search inventory">
                        Search
                    </Button>
                </SpaceBetween>
            </FormField>

            {searchError && (
                <Alert type="error" dismissible onDismiss={() => setSearchError('')}>{searchError}</Alert>
            )}
            {noResults && <Alert type="info">No servers found for this MOTSID.</Alert>}

            {/* Search Results */}
            {inventoryData && (
                <SpaceBetween size="l">
                    {/* Match Summary */}
                    <Container header={<Header variant="h3">Application Sync</Header>}>
                        <SpaceBetween size="s">
                            <Box>
                                <SpaceBetween direction="horizontal" size="xs">
                                    <StatusIndicator type="info">
                                        {inventoryData.sources.length} Source Server{inventoryData.sources.length !== 1 ? 's' : ''}
                                    </StatusIndicator>
                                    <StatusIndicator type="info">
                                        {inventoryData.targets.length} Target Server{inventoryData.targets.length !== 1 ? 's' : ''}
                                    </StatusIndicator>
                                    {(inventoryData.sources[0]?.appName || inventoryData.targets[0]?.appName) && (
                                        <StatusIndicator type="info">
                                            App: {inventoryData.sources[0]?.appName || inventoryData.targets[0]?.appName}
                                        </StatusIndicator>
                                    )}
                                    {matchSummary && (
                                        <StatusIndicator
                                            type={matchSummary.matchedCount === matchSummary.totalSources && matchSummary.extraTargetCount === 0 ? 'success' : matchSummary.matchedCount === 0 ? 'error' : 'warning'}
                                        >
                                            {matchSummary.matchedCount} of {matchSummary.totalSources} sources matched
                                            {matchSummary.extraTargetCount > 0 ? `, ${matchSummary.extraTargetCount} extra target${matchSummary.extraTargetCount !== 1 ? 's' : ''}` : ''}
                                        </StatusIndicator>
                                    )}
                                </SpaceBetween>
                            </Box>
                            <Box>
                                <SpaceBetween direction="horizontal" size="xxs">
                                    {inventoryData.sources.map(s => {
                                        const hasTarget = inventoryData.targets.some(t => t.serverName === s.serverName)
                                        return (
                                            <Box key={s.serverId} variant="small" display="inline-block" padding={{ horizontal: 'xs', vertical: 'xxxs' }}
                                                color={hasTarget ? 'text-status-success' : 'text-status-inactive'}>
                                                {hasTarget ? '✓' : '✗'} {s.serverName}
                                                {!hasTarget ? ' (no target)' : ''}
                                            </Box>
                                        )
                                    })}
                                    {matchSummary?.extraTargets.map(t => (
                                        <Box key={t.serverId} variant="small" display="inline-block" padding={{ horizontal: 'xs', vertical: 'xxxs' }}
                                            color="text-status-info">
                                            + {t.serverName} (extra target)
                                        </Box>
                                    ))}
                                </SpaceBetween>
                            </Box>
                            {matchSummary && (matchSummary.matchedCount < matchSummary.totalSources || matchSummary.extraTargetCount > 0) && (
                                <Alert type="warning">
                                    Migration Note: {matchSummary.matchedCount < matchSummary.totalSources
                                        ? `${matchSummary.matchedCount} of ${matchSummary.totalSources} source servers have a matching target`
                                        : ''}
                                    {matchSummary.matchedCount < matchSummary.totalSources && matchSummary.extraTargetCount > 0 ? '. ' : ''}
                                    {matchSummary.extraTargetCount > 0
                                        ? `${matchSummary.extraTargetCount} target${matchSummary.extraTargetCount !== 1 ? 's' : ''} (${matchSummary.extraTargets.map(t => t.serverName).join(', ')}) ha${matchSummary.extraTargetCount !== 1 ? 've' : 's'} no corresponding source`
                                        : ''}
                                    .
                                </Alert>
                            )}
                        </SpaceBetween>
                    </Container>

                    {/* Batch Validation */}
                    {allSourcesMatched && (
                        <Container header={<Header variant="h3">Batch Validation</Header>}>
                            <SpaceBetween size="m">
                                <SpaceBetween direction="horizontal" size="xs">
                                    <Button onClick={handleValidateAll} loading={validateAllRunning} disabled={validateAllRunning} variant="primary">
                                        Validate All
                                    </Button>
                                    {validateAllRunning && (
                                        <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
                                            {validateAllProgress.completed} of {validateAllProgress.total} validated
                                        </Box>
                                    )}
                                </SpaceBetween>

                                {validateAllStatus === 'done' && (
                                    <SpaceBetween direction="horizontal" size="xs">
                                        <Badge color="green">{passedCount} passed</Badge>
                                        <Badge color="red">{failedCount} failed</Badge>
                                        <Badge color="grey">{erroredCount} errored</Badge>
                                    </SpaceBetween>
                                )}

                                {/* Validation Results Accordion */}
                                {validateAllStatus === 'done' && validateAllResults.length > 0 && (
                                    <SpaceBetween size="s">
                                        {validateAllResults.map((entry, idx) => {
                                            const isExpanded = entry.status !== 'passed'
                                            const badgeType = entry.status === 'passed' ? 'success' : entry.status === 'failed' ? 'error' : 'warning'
                                            const badgeLabel = entry.status === 'passed' ? 'Passed' : entry.status === 'failed' ? 'Failed' : 'Error'
                                            return (
                                                <ExpandableSection
                                                    key={idx}
                                                    defaultExpanded={isExpanded}
                                                    headerText={entry.serverName}
                                                    headerDescription={`${entry.sourceIp} → ${entry.targetInstanceId}`}
                                                    variant="container"
                                                    headerActions={<StatusIndicator type={badgeType}>{badgeLabel}</StatusIndicator>}
                                                >
                                                    {entry.status === 'error' && (
                                                        <Alert type="warning">{entry.error || 'Unknown error'}</Alert>
                                                    )}
                                                    {entry.status !== 'error' && entry.results && (
                                                        <ValidationDetails results={entry.results} />
                                                    )}
                                                </ExpandableSection>
                                            )
                                        })}
                                    </SpaceBetween>
                                )}

                                {/* Sync All Button */}
                                {showSyncAll && syncAllStatus === 'idle' && (
                                    <Button onClick={handleSyncAll} variant="primary">{syncAllLabel}</Button>
                                )}

                                {/* Sync All Progress */}
                                {syncAllStatus !== 'idle' && (
                                    <SpaceBetween size="m">
                                        <ProgressBar
                                            value={syncAllPct}
                                            label={syncAllStatus === 'submitting' ? 'Submitting sync jobs' : 'Sync progress'}
                                            description={
                                                syncAllStatus === 'submitting'
                                                    ? `${syncAllProgress.submitted} of ${syncAllProgress.total} jobs submitted (${syncAllProgress.succeeded} ok, ${syncAllProgress.failed} failed)`
                                                    : `${syncAllTerminalCount}/${syncAllProgress.total} servers complete (${syncAllPct}%)`
                                            }
                                            status={syncAllStatus === 'done' && syncAllProgress.failed > 0 ? 'error' : syncAllStatus === 'done' ? 'success' : 'in-progress'}
                                        />
                                        {syncAllJobs.length > 0 && (
                                            <SpaceBetween size="xs">
                                                {syncAllJobs.map((job, idx) => {
                                                    let indicatorType: 'pending' | 'success' | 'error' | 'in-progress' = 'pending'
                                                    let label = 'Queued'
                                                    if (job.status === 'COMPLETED') { indicatorType = 'success'; label = 'Completed' }
                                                    else if (job.status === 'FAILED' || job.status === 'SUBMIT_FAILED') { indicatorType = 'error'; label = job.status === 'SUBMIT_FAILED' ? 'Submit Failed' : 'Failed' }
                                                    else if (job.status === 'RUNNING') { indicatorType = 'in-progress'; label = 'Running' }
                                                    return (
                                                        <Box key={idx}>
                                                            <SpaceBetween direction="horizontal" size="xs">
                                                                <Box>{job.serverName}</Box>
                                                                <StatusIndicator type={indicatorType}>{label}</StatusIndicator>
                                                            </SpaceBetween>
                                                        </Box>
                                                    )
                                                })}
                                            </SpaceBetween>
                                        )}
                                    </SpaceBetween>
                                )}
                            </SpaceBetween>
                        </Container>
                    )}

                    {/* Server Selection */}
                    <Container header={<Header variant="h3">Server Selection</Header>}>
                        <ColumnLayout columns={2}>
                            <FormField label="Source Server">
                                <Select
                                    selectedOption={sourceSelectedOption}
                                    onChange={handleSourceChange}
                                    options={sourceOptions}
                                    placeholder="Select source server..."
                                    ariaLabel="Source server selection"
                                />
                            </FormField>
                            <FormField label="Target Server">
                                <Select
                                    selectedOption={targetSelectedOption}
                                    onChange={handleTargetChange}
                                    options={targetOptions}
                                    placeholder="Select target server..."
                                    ariaLabel="Target server selection"
                                />
                            </FormField>
                        </ColumnLayout>
                        {selectedSource && selectedTarget && (
                            <Box margin={{ top: 's' }}>
                                <SpaceBetween direction="horizontal" size="xs">
                                    <StatusIndicator type="info">Source: {selectedSource.hostIp}</StatusIndicator>
                                    <StatusIndicator type="success">Target: {selectedTarget.targetInstanceId}</StatusIndicator>
                                    <StatusIndicator type="info">OS: {selectedSource.operatingSystem}</StatusIndicator>
                                    <StatusIndicator type="info">Credential: ...{selectedSource.sshKeyArn?.slice(-12)}</StatusIndicator>
                                    {selectedTarget.targetAccountId && (
                                        <StatusIndicator type="warning">Account: {selectedTarget.targetAccountId}</StatusIndicator>
                                    )}
                                    <StatusIndicator type="stopped">
                                        Cred: {selectedSource.credentialType === 'parameterstore' ? 'Parameter Store' : 'Secrets Manager'}
                                    </StatusIndicator>
                                </SpaceBetween>
                            </Box>
                        )}
                    </Container>

                    {/* Sync Paths */}
                    {selectedSource && selectedTarget && (selectedSource.syncPaths || []).length > 0 && (
                        <Container header={<Header variant="h3">Sync Paths</Header>}>
                            <FormField description="Select which paths to sync">
                                <SpaceBetween size="xs">
                                    {(selectedSource.syncPaths || []).map((path, idx) => (
                                        <Checkbox
                                            key={idx}
                                            checked={selectedPaths.includes(path)}
                                            onChange={({ detail }) => togglePath(path, detail.checked)}
                                        >
                                            {path}
                                        </Checkbox>
                                    ))}
                                </SpaceBetween>
                            </FormField>
                        </Container>
                    )}

                    {/* Options */}
                    {selectedSource && selectedTarget && (
                        <Container header={<Header variant="h3">Options</Header>}>
                            <SpaceBetween size="m">
                                <ColumnLayout columns={2}>
                                    <FormField label="Bandwidth Limit">
                                        <Select
                                            selectedOption={bandwidthLimit}
                                            onChange={({ detail }) => setBandwidthLimit(detail.selectedOption)}
                                            options={BANDWIDTH_OPTIONS}
                                            ariaLabel="Bandwidth limit"
                                        />
                                    </FormField>
                                    <FormField label="Exclude Patterns">
                                        <Input
                                            value={excludePatterns}
                                            onChange={({ detail }) => setExcludePatterns(detail.value)}
                                            placeholder="*.tmp,*.log,cache/*"
                                        />
                                    </FormField>
                                </ColumnLayout>
                                {isLinux && (
                                    <ColumnLayout columns={2}>
                                        <Checkbox checked={preserveACL} onChange={({ detail }) => setPreserveACL(detail.checked)}>
                                            Preserve ACLs (-A)
                                        </Checkbox>
                                        <Checkbox checked={preserveXattrs} onChange={({ detail }) => setPreserveXattrs(detail.checked)}>
                                            Preserve Extended Attributes (-X)
                                        </Checkbox>
                                    </ColumnLayout>
                                )}
                                <FormField label="Tags (Optional)">
                                    <Input value={jobTags} onChange={({ detail }) => setJobTags(detail.value)} placeholder="production, database, wave1" />
                                </FormField>
                            </SpaceBetween>
                        </Container>
                    )}

                    {/* Execution Schedule */}
                    {selectedSource && selectedTarget && (
                        <Container header={<Header variant="h3">Execution Schedule</Header>}>
                            <SpaceBetween size="m">
                                <RadioGroup
                                    value={executionMode}
                                    onChange={({ detail }) => setExecutionMode(detail.value)}
                                    items={[
                                        { value: 'now', label: 'Run Now' },
                                        { value: 'once', label: 'Schedule Once' },
                                        { value: 'recurring', label: 'Schedule Recurring' },
                                    ]}
                                    ariaLabel="Execution schedule"
                                />
                                {(executionMode === 'once' || executionMode === 'recurring') && (
                                    <FormField label="Timezone">
                                        <RadioGroup
                                            value={timezone}
                                            onChange={({ detail }) => setTimezone(detail.value)}
                                            items={[
                                                { value: 'utc', label: 'UTC' },
                                                { value: 'local', label: 'Local' },
                                            ]}
                                            ariaLabel="Timezone selection"
                                        />
                                    </FormField>
                                )}
                                {executionMode === 'once' && (
                                    <ColumnLayout columns={2}>
                                        <FormField label={`Date (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                            <Input value={scheduleDate} onChange={({ detail }) => setScheduleDate(detail.value)} placeholder="YYYY-MM-DD" />
                                        </FormField>
                                        <FormField label={`Time (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                            <Input value={scheduleTime} onChange={({ detail }) => setScheduleTime(detail.value)} placeholder="HH:MM" />
                                        </FormField>
                                    </ColumnLayout>
                                )}
                                {executionMode === 'recurring' && (
                                    <ColumnLayout columns={3}>
                                        <FormField label={`Start Date (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                            <Input value={recurringStartDate} onChange={({ detail }) => setRecurringStartDate(detail.value)} placeholder="YYYY-MM-DD" />
                                        </FormField>
                                        <FormField label={`Start Time (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                            <Input value={recurringStartTime} onChange={({ detail }) => setRecurringStartTime(detail.value)} placeholder="HH:MM" />
                                        </FormField>
                                        <FormField label="Run for (days)">
                                            <Input type="number" value={recurringDays} onChange={({ detail }) => setRecurringDays(detail.value)} inputMode="numeric" />
                                        </FormField>
                                    </ColumnLayout>
                                )}
                            </SpaceBetween>
                        </Container>
                    )}

                    {/* Action Buttons */}
                    {selectedSource && selectedTarget && (
                        <SpaceBetween size="s">
                            {conflictWarning && <Alert type="warning">{conflictWarning}</Alert>}
                            {submitError && <Alert type="error" dismissible onDismiss={() => setSubmitError('')}>{submitError}</Alert>}
                            {submitSuccess && <Alert type="success" dismissible onDismiss={() => setSubmitSuccess('')}>{submitSuccess}</Alert>}
                            <SpaceBetween direction="horizontal" size="xs">
                                <Button onClick={handleValidate} loading={validating} disabled={!canSubmit} variant="normal">
                                    Validate
                                </Button>
                                <Button onClick={handleSubmit} loading={submitting} disabled={!canSubmit} variant="primary">
                                    Start Sync
                                </Button>
                            </SpaceBetween>
                        </SpaceBetween>
                    )}
                </SpaceBetween>
            )}
        </SpaceBetween>
    )
}

// Validation details for batch validation accordion entries
function ValidationDetails({ results }: { results: Record<string, unknown> }) {
    return (
        <SpaceBetween size="s">
            <Box>
                <Box variant="awsui-key-label">Connectivity</Box>
                <StatusIndicator type={results.connectivity_status === 'SUCCESS' ? 'success' : 'error'}>
                    {results.connectivity_status === 'SUCCESS' ? 'Connected' : 'Failed'}
                </StatusIndicator>
            </Box>
            <Box>
                <Box variant="awsui-key-label">Disk Space</Box>
                <StatusIndicator type={results.space_check_status === 'SUFFICIENT' ? 'success' : 'error'}>
                    {results.space_check_status === 'SUFFICIENT' ? 'Sufficient' : 'Insufficient'}
                </StatusIndicator>
            </Box>
            {!!(results.source_os_distro_family || results.target_os_distro_family || results.os_family || results.source_os_family || results.target_os_family) && (
                <Box>
                    <Box variant="awsui-key-label">OS Compatibility</Box>
                    <ColumnLayout columns={3}>
                        <Box>
                            <Box variant="awsui-key-label">Source OS</Box>
                            <Box>
                                {String(results.source_os_distro_family || results.os_family || results.source_os_family || 'Unknown')}
                                {(results.source_os_distro_version || results.os_version) ? ` ${String(results.source_os_distro_version || results.os_version)}` : ''}
                            </Box>
                            {!!(results.source_os_distro_source || results.os_detection_source) && (
                                <Box variant="small" color="text-body-secondary">Detected via {String(results.source_os_distro_source || results.os_detection_source)}</Box>
                            )}
                            {!!results.source_os_detail && !results.source_os_distro_family && (
                                <Box variant="small" color="text-body-secondary">{String(results.source_os_detail)}</Box>
                            )}
                        </Box>
                        <Box>
                            <Box variant="awsui-key-label">Target OS</Box>
                            <Box>
                                {String(results.target_os_distro_family || results.target_os_family || 'Unknown')}
                                {results.target_os_distro_version ? ` ${String(results.target_os_distro_version)}` : ''}
                            </Box>
                            {!!results.target_os_distro_source && (
                                <Box variant="small" color="text-body-secondary">Detected via {String(results.target_os_distro_source)}</Box>
                            )}
                            {!!results.target_os_detail && !results.target_os_distro_family && (
                                <Box variant="small" color="text-body-secondary">{String(results.target_os_detail)}</Box>
                            )}
                        </Box>
                        <Box>
                            <Box variant="awsui-key-label">Compatibility</Box>
                            <StatusIndicator type={results.os_compatibility === 'INCOMPATIBLE' ? 'error' : 'success'}>
                                {String(results.os_compatibility || 'Compatible')}
                            </StatusIndicator>
                        </Box>
                    </ColumnLayout>
                </Box>
            )}
            {!(results.mode === 'MULTI_PATH' && parseInt(String(results.path_count)) > 1) && (
                <Box>
                    <Box variant="awsui-key-label">Disk Metrics</Box>
                    <ColumnLayout columns={3}>
                        <Box>
                            <Box variant="awsui-key-label">Source Filesystem Used</Box>
                            <Box>
                                {results.source_filesystem_used_gb != null
                                    ? `${results.source_filesystem_used_gb} GB`
                                    : (results.source_size_gb != null ? `${results.source_size_gb} GB` : 'N/A')}
                            </Box>
                            {!!results.source_fs_warning && (
                                <Box variant="small" color="text-status-warning">{String(results.source_fs_warning)}</Box>
                            )}
                            {!!results.source_fs_error && (
                                <Box variant="small" color="text-status-error">{String(results.source_fs_error)}</Box>
                            )}
                        </Box>
                        <Box>
                            <Box variant="awsui-key-label">File Count</Box>
                            <Box>{results.source_file_count != null ? String(results.source_file_count) : 'N/A'}</Box>
                        </Box>
                        <Box>
                            <Box variant="awsui-key-label">Target Available</Box>
                            <Box>{results.target_avail_gb != null ? `${results.target_avail_gb} GB` : 'N/A'}</Box>
                        </Box>
                    </ColumnLayout>
                </Box>
            )}
        </SpaceBetween>
    )
}
