import { useState, useEffect, useRef } from 'react'
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
import Modal from '@cloudscape-design/components/modal'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Table from '@cloudscape-design/components/table'
import type { SelectProps } from '@cloudscape-design/components/select'
import type { CreateJobParams, SyncJob } from '../services/api'
import { listAccounts, runValidation, getValidationResults, createSchedule } from '../services/api'

interface AdvancedModeProps {
    onCreateJob: (config: CreateJobParams) => Promise<SyncJob>
    cloneSource?: SyncJob | null
}

interface PathPairEntry {
    id: number
    sourcePath: string
    targetPath: string
}

const OS_OPTIONS: SelectProps.Option[] = [
    { label: 'Linux', value: 'Linux' },
    { label: 'Windows', value: 'Windows' },
    { label: 'Unix', value: 'Unix' },
]

const CREDENTIAL_TYPE_OPTIONS: SelectProps.Option[] = [
    { label: 'Secrets Manager', value: 'secretsmanager' },
    { label: 'Parameter Store', value: 'parameterstore' },
]

const TRANSFER_ENGINE_OPTIONS: SelectProps.Option[] = [
    { label: 'rsync (Standard)', value: 'rsync' },
    { label: 'rclone (Accelerated) — Experimental', value: 'rclone' },
]

const BANDWIDTH_OPTIONS: SelectProps.Option[] = [
    { label: 'Unlimited', value: '' },
    { label: '10 MB/s', value: '10000' },
    { label: '50 MB/s', value: '50000' },
    { label: '100 MB/s', value: '100000' },
    { label: '500 MB/s', value: '500000' },
]

const AWS_REGION_OPTIONS: SelectProps.Option[] = [
    { label: 'US East (N. Virginia) — us-east-1', value: 'us-east-1' },
    { label: 'US East (Ohio) — us-east-2', value: 'us-east-2' },
    { label: 'US West (N. California) — us-west-1', value: 'us-west-1' },
    { label: 'US West (Oregon) — us-west-2', value: 'us-west-2' },
    { label: 'EU (Ireland) — eu-west-1', value: 'eu-west-1' },
    { label: 'EU (Frankfurt) — eu-central-1', value: 'eu-central-1' },
    { label: 'EU (London) — eu-west-2', value: 'eu-west-2' },
    { label: 'EU (Paris) — eu-west-3', value: 'eu-west-3' },
    { label: 'EU (Stockholm) — eu-north-1', value: 'eu-north-1' },
    { label: 'AP (Tokyo) — ap-northeast-1', value: 'ap-northeast-1' },
    { label: 'AP (Seoul) — ap-northeast-2', value: 'ap-northeast-2' },
    { label: 'AP (Singapore) — ap-southeast-1', value: 'ap-southeast-1' },
    { label: 'AP (Sydney) — ap-southeast-2', value: 'ap-southeast-2' },
    { label: 'AP (Mumbai) — ap-south-1', value: 'ap-south-1' },
    { label: 'SA (São Paulo) — sa-east-1', value: 'sa-east-1' },
    { label: 'CA (Central) — ca-central-1', value: 'ca-central-1' },
    { label: 'ME (Bahrain) — me-south-1', value: 'me-south-1' },
    { label: 'AF (Cape Town) — af-south-1', value: 'af-south-1' },
]

// Control plane region — used as default for target region dropdown
const CONTROL_PLANE_REGION = 'us-east-1'
const DEFAULT_REGION_OPTION = AWS_REGION_OPTIONS.find(o => o.value === CONTROL_PLANE_REGION) || AWS_REGION_OPTIONS[0]

type ValidationStatus = 'pending' | 'polling' | 'completed' | 'failed' | 'timeout'

export default function AdvancedMode({ onCreateJob, cloneSource }: AdvancedModeProps) {
    // Form fields
    const [jobName, setJobName] = useState('')
    const [operatingSystem, setOperatingSystem] = useState<SelectProps.Option>(OS_OPTIONS[0])
    const [sourceHost, setSourceHost] = useState('')
    const [targetInstanceId, setTargetInstanceId] = useState('')
    const [sshKeyArn, setSshKeyArn] = useState('')
    const [arnFocused, setArnFocused] = useState(false)
    const [credentialType, setCredentialType] = useState<SelectProps.Option>(CREDENTIAL_TYPE_OPTIONS[0])
    const [transferEngine, setTransferEngine] = useState<SelectProps.Option>(TRANSFER_ENGINE_OPTIONS[0])
    const [bandwidthLimit, setBandwidthLimit] = useState<SelectProps.Option>(BANDWIDTH_OPTIONS[0])
    const [excludePatterns, setExcludePatterns] = useState('')
    const [preserveACL, setPreserveACL] = useState(true)
    const [preserveXattrs, setPreserveXattrs] = useState(true)
    const [jobTags, setJobTags] = useState('')
    const [targetAccount, setTargetAccount] = useState<SelectProps.Option>({ label: 'Same Account (Control Plane)', value: '' })
    const [accountOptions, setAccountOptions] = useState<SelectProps.Option[]>([{ label: 'Same Account (Control Plane)', value: '' }])
    const [credentialFormat, setCredentialFormat] = useState('ssh-key')
    const [targetRegion, setTargetRegion] = useState<SelectProps.Option>(DEFAULT_REGION_OPTION)
    const [crossRegionAlertDismissed, setCrossRegionAlertDismissed] = useState(false)

    // Path pairs
    const pathPairIdRef = useRef(1)
    const [pathPairs, setPathPairs] = useState<PathPairEntry[]>([{ id: 0, sourcePath: '', targetPath: '' }])

    // Execution schedule
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

    // Validation modal state
    const [validationModalVisible, setValidationModalVisible] = useState(false)
    const [validationStatus, setValidationStatus] = useState<ValidationStatus>('pending')
    const [validationResults, setValidationResults] = useState<Record<string, unknown> | null>(null)
    const [validationError, setValidationError] = useState('')

    const isWindows = operatingSystem.value === 'Windows'
    const isLinuxOrUnix = !isWindows
    const isRsync = transferEngine.value === 'rsync'
    const isCrossRegion = targetRegion.value !== CONTROL_PLANE_REGION

    // Auto-switch credential format for Windows (no SSH keys)
    useEffect(() => {
        if (isWindows) {
            setCredentialFormat('username-password')
        }
    }, [isWindows])

    // Pre-fill from cloneSource
    useEffect(() => {
        if (!cloneSource) return
        setJobName(`${cloneSource.jobName || 'Unnamed'} (copy)`)
        const os = cloneSource.operatingSystem || 'Linux'
        setOperatingSystem(OS_OPTIONS.find(o => o.value === os) || OS_OPTIONS[0])
        setSourceHost(cloneSource.sourceHost || '')
        setTargetInstanceId(cloneSource.targetInstanceId || '')
        setSshKeyArn(cloneSource.sshKeyArn || '')
        const ct = cloneSource.credentialType || 'secretsmanager'
        setCredentialType(CREDENTIAL_TYPE_OPTIONS.find(o => o.value === ct) || CREDENTIAL_TYPE_OPTIONS[0])
        const te = cloneSource.transferEngine || 'rsync'
        setTransferEngine(TRANSFER_ENGINE_OPTIONS.find(o => o.value === te) || TRANSFER_ENGINE_OPTIONS[0])
        const bw = cloneSource.bandwidthLimit || ''
        setBandwidthLimit(BANDWIDTH_OPTIONS.find(o => o.value === String(bw)) || BANDWIDTH_OPTIONS[0])
        setExcludePatterns(cloneSource.excludePatterns || '')
        setPreserveACL(cloneSource.preserveACL !== false)
        setPreserveXattrs(cloneSource.preserveXattrs !== false)
        setJobTags(Array.isArray(cloneSource.tags) ? cloneSource.tags.join(', ') : '')
        setCredentialFormat(cloneSource.credentialFormat || 'ssh-key')
        const pairs = cloneSource.pathPairs?.length > 0
            ? cloneSource.pathPairs.map(p => ({ id: pathPairIdRef.current++, sourcePath: p.sourcePath || '', targetPath: p.targetPath || '' }))
            : [{ id: pathPairIdRef.current++, sourcePath: '', targetPath: '' }]
        setPathPairs(pairs)
        if (cloneSource.targetAccountId) {
            const match = accountOptions.find(o => o.value === cloneSource.targetAccountId)
            if (match) {
                setTargetAccount(match)
            } else {
                const alias = cloneSource.targetAccountAlias || ''
                const last4 = cloneSource.targetAccountId.slice(-4)
                const label = alias ? `${alias} (***${last4})` : `***${last4}`
                setTargetAccount({ label, value: cloneSource.targetAccountId, description: alias })
            }
        }
        // Pre-populate target region from clone source
        if (cloneSource.targetRegion) {
            const regionMatch = AWS_REGION_OPTIONS.find(o => o.value === cloneSource.targetRegion)
            setTargetRegion(regionMatch || DEFAULT_REGION_OPTION)
        }
        setCrossRegionAlertDismissed(false)
    }, [cloneSource, accountOptions])

    // Load registered accounts
    useEffect(() => {
        listAccounts()
            .then(data => {
                const accts = data.accounts || []
                const opts: SelectProps.Option[] = [{ label: 'Same Account (Control Plane)', value: '' }]
                accts.forEach(a => {
                    opts.push({ label: `${a.alias} (***${a.accountId.slice(-4)})`, value: a.accountId, description: a.alias })
                })
                setAccountOptions(opts)
            })
            .catch(() => { /* ignore */ })
    }, [])

    const addPathPair = () => {
        const id = pathPairIdRef.current++
        setPathPairs(prev => [...prev, { id, sourcePath: '', targetPath: '' }])
    }

    const removePathPair = (index: number) => {
        setPathPairs(prev => prev.filter((_, i) => i !== index))
    }

    const updatePathPair = (index: number, field: 'sourcePath' | 'targetPath', value: string) => {
        setPathPairs(prev => prev.map((pair, i) =>
            i === index ? { ...pair, [field]: value } : pair
        ))
    }

    const hasValidPathPairs = pathPairs.some(p => p.sourcePath.trim() && p.targetPath.trim())
    const canSubmit = jobName.trim() && sourceHost.trim() && targetInstanceId.trim()
        && sshKeyArn.trim() && hasValidPathPairs && !submitting

    const buildPayload = (): CreateJobParams => {
        const validPairs = pathPairs
            .filter(p => p.sourcePath.trim() && p.targetPath.trim())
            .map(p => ({ sourcePath: p.sourcePath, targetPath: p.targetPath }))
        const tagsArray = jobTags.trim()
            ? jobTags.split(',').map(t => t.trim()).filter(Boolean)
            : []

        const payload: CreateJobParams = {
            jobName: jobName.trim(),
            operatingSystem: operatingSystem.value!,
            sourceHost: sourceHost.trim(),
            targetInstanceId: targetInstanceId.trim(),
            sshKeyArn: sshKeyArn.trim(),
            pathPairs: validPairs,
            credentialType: credentialType.value,
            transferEngine: isWindows ? 'robocopy' : transferEngine.value,
        }

        if (bandwidthLimit.value) payload.bandwidthLimit = bandwidthLimit.value
        if (excludePatterns.trim()) payload.excludePatterns = excludePatterns.trim()
        if (isLinuxOrUnix && isRsync) {
            payload.preserveACL = preserveACL
            payload.preserveXattrs = preserveXattrs
        }
        if (tagsArray.length > 0) payload.tags = tagsArray
        if (targetAccount.value) {
            payload.targetAccountId = targetAccount.value
            if (targetAccount.description) payload.targetAccountAlias = targetAccount.description
        }
        if (targetRegion.value && targetRegion.value !== CONTROL_PLANE_REGION) {
            payload.targetRegion = targetRegion.value
        }
        if (credentialFormat === 'username-password') {
            payload.credentialFormat = 'username-password'
        }
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

        return payload
    }

    const resetForm = () => {
        setJobName('')
        setOperatingSystem(OS_OPTIONS[0])
        setSourceHost('')
        setTargetInstanceId('')
        setSshKeyArn('')
        setCredentialType(CREDENTIAL_TYPE_OPTIONS[0])
        setTransferEngine(TRANSFER_ENGINE_OPTIONS[0])
        setBandwidthLimit(BANDWIDTH_OPTIONS[0])
        setExcludePatterns('')
        setPreserveACL(true)
        setPreserveXattrs(true)
        setJobTags('')
        setTargetAccount({ label: 'Same Account (Control Plane)', value: '' })
        setCredentialFormat('ssh-key')
        setTargetRegion(DEFAULT_REGION_OPTION)
        setCrossRegionAlertDismissed(false)
        pathPairIdRef.current = 1
        setPathPairs([{ id: 0, sourcePath: '', targetPath: '' }])
        setExecutionMode('now')
        setScheduleDate('')
        setScheduleTime('')
        setRecurringStartDate('')
        setRecurringStartTime('02:00')
        setRecurringDays('7')
        setTimezone('utc')
    }

    const handleSubmit = async () => {
        if (!canSubmit) return
        setSubmitting(true)
        setSubmitError('')
        setSubmitSuccess('')

        try {
            const payload = buildPayload()

            if (executionMode === 'now') {
                await onCreateJob(payload)
                setSubmitSuccess(`Sync job created: ${jobName}`)
                resetForm()
            } else if (executionMode === 'once') {
                if (!scheduleDate || !scheduleTime) {
                    setSubmitError('Please select date and time for scheduled execution')
                    return
                }

                let dateTime: Date
                let tz: string
                if (timezone === 'local') {
                    const [year, month, day] = scheduleDate.split('-').map(Number)
                    const [hour, minute] = scheduleTime.split(':').map(Number)
                    dateTime = new Date(year, month - 1, day, hour, minute, 0)
                    tz = Intl.DateTimeFormat().resolvedOptions().timeZone
                } else {
                    dateTime = new Date(scheduleDate + 'T' + scheduleTime + ':00Z')
                    tz = 'UTC'
                }

                const cronMinute = dateTime.getUTCMinutes()
                const cronHour = dateTime.getUTCHours()
                const cronDay = dateTime.getUTCDate()
                const cronMonth = dateTime.getUTCMonth() + 1
                const cronYear = dateTime.getUTCFullYear()
                const cronExpression = `${cronMinute} ${cronHour} ${cronDay} ${cronMonth} ? ${cronYear}`
                const tzLabel = timezone === 'local' ? 'Local' : 'UTC'
                const scheduleName = `${jobName.trim()} (Scheduled ${scheduleDate} ${scheduleTime} ${tzLabel})`

                await createSchedule({
                    scheduleName,
                    cronExpression,
                    timezone: tz,
                    enabled: true,
                    jobTemplate: payload,
                    scheduleType: 'once',
                })
                setSubmitSuccess(`Job scheduled for ${scheduleDate} ${scheduleTime} ${tzLabel}`)
                resetForm()
            } else if (executionMode === 'recurring') {
                if (!recurringStartTime) {
                    setSubmitError('Please provide a valid start time for recurring schedule')
                    return
                }

                const days = parseInt(recurringDays, 10) || 7
                let dateTime: Date
                let tz: string
                if (timezone === 'local') {
                    const startDate = recurringStartDate || new Date().toISOString().split('T')[0]
                    const [year, month, day] = startDate.split('-').map(Number)
                    const [hour, minute] = recurringStartTime.split(':').map(Number)
                    dateTime = new Date(year, month - 1, day, hour, minute, 0)
                    tz = Intl.DateTimeFormat().resolvedOptions().timeZone
                } else {
                    const startDate = recurringStartDate || new Date().toISOString().split('T')[0]
                    dateTime = new Date(startDate + 'T' + recurringStartTime + ':00Z')
                    tz = 'UTC'
                }

                const cronMinute = dateTime.getUTCMinutes()
                const cronHour = dateTime.getUTCHours()
                const cronExpression = `${cronMinute} ${cronHour} * * ? *`
                const scheduleName = `${jobName.trim()} (Daily for ${days} days)`

                const end = new Date(dateTime)
                end.setDate(end.getDate() + days)

                await createSchedule({
                    scheduleName,
                    cronExpression,
                    timezone: tz,
                    enabled: true,
                    jobTemplate: payload,
                    scheduleType: 'recurring',
                    endDate: end.toISOString(),
                })
                setSubmitSuccess(`Recurring job scheduled — will run daily for ${days} days`)
                resetForm()
            }
        } catch (err) {
            setSubmitError((err as Error).message || 'Failed to create job')
        } finally {
            setSubmitting(false)
        }
    }

    const handleValidate = async () => {
        if (!canSubmit) return
        setValidating(true)
        setSubmitError('')
        setValidationModalVisible(true)
        setValidationStatus('pending')
        setValidationResults(null)
        setValidationError('')

        try {
            const validPairs = pathPairs
                .filter(p => p.sourcePath.trim() && p.targetPath.trim())
                .map(p => ({ sourcePath: p.sourcePath, targetPath: p.targetPath }))
            const payload: Record<string, unknown> = {
                jobName: jobName.trim(),
                sourceHost: sourceHost.trim(),
                targetInstanceId: targetInstanceId.trim(),
                sshKeyArn: sshKeyArn.trim(),
                pathPairs: validPairs,
                operatingSystem: operatingSystem.value,
                credentialType: credentialType.value,
            }
            if (credentialFormat === 'username-password') payload.credentialFormat = 'username-password'
            if (targetAccount.value) payload.targetAccountId = targetAccount.value
            if (targetRegion.value && targetRegion.value !== CONTROL_PLANE_REGION) {
                payload.targetRegion = targetRegion.value
            }

            const result = await runValidation(payload)

            if (result?.status === 'FAILED') {
                setValidationStatus('failed')
                setValidationError(result.error || 'Pre-flight check failed')
                setValidating(false)
                return
            }

            const validationId = result?.validationId
            if (!validationId) {
                setValidationStatus('failed')
                setValidationError('No validation ID returned')
                setValidating(false)
                return
            }

            // Poll for results
            setValidationStatus('polling')
            const params: Record<string, string> = {}
            if (result.ssmCommandId) params.ssmCommandId = result.ssmCommandId
            if (result.instanceId || targetInstanceId.trim()) params.instanceId = result.instanceId || targetInstanceId.trim()
            if (result.targetAccountId || targetAccount.value) params.targetAccountId = result.targetAccountId || targetAccount.value!
            if (targetRegion.value && targetRegion.value !== CONTROL_PLANE_REGION) params.targetRegion = targetRegion.value

            let attempts = 0
            const maxAttempts = 30
            const poll = setInterval(async () => {
                attempts++
                try {
                    const data = await getValidationResults(validationId, params)
                    if (data.status === 'COMPLETED') {
                        clearInterval(poll)
                        setValidationStatus('completed')
                        setValidationResults((data.results || data) as Record<string, unknown>)
                        setValidating(false)
                    } else if (data.status === 'FAILED') {
                        clearInterval(poll)
                        setValidationStatus('failed')
                        setValidationError(data.error || 'Validation failed')
                        setValidationResults((data.results || null) as Record<string, unknown> | null)
                        setValidating(false)
                    } else if (attempts >= maxAttempts) {
                        clearInterval(poll)
                        setValidationStatus('timeout')
                        setValidating(false)
                    }
                } catch (pollErr) {
                    if (attempts >= maxAttempts) {
                        clearInterval(poll)
                        setValidationStatus('failed')
                        setValidationError((pollErr as Error).message || 'Polling failed')
                        setValidating(false)
                    }
                }
            }, 5000)
        } catch (err) {
            setValidationStatus('failed')
            setValidationError((err as Error).message || 'Validation failed')
            setValidating(false)
        }
    }

    return (
        <SpaceBetween size="l">
            {/* Job Name */}
            <FormField label="Job Name" description="Human-readable name to identify this sync job">
                <Input
                    value={jobName}
                    onChange={({ detail }) => setJobName(detail.value)}
                    placeholder="Production DB Sync"
                    ariaLabel="Job name"
                />
            </FormField>

            {/* OS Selection */}
            <FormField label="Source Operating System">
                <Select
                    selectedOption={operatingSystem}
                    onChange={({ detail }) => setOperatingSystem(detail.selectedOption)}
                    options={OS_OPTIONS}
                    ariaLabel="Operating system"
                />
            </FormField>

            {operatingSystem.value === 'Unix' && (
                <Alert type="warning">
                    Unix Limitation: Some metadata and ACLs may not migrate with the data when using rsync on Unix systems.
                </Alert>
            )}

            {/* Source Host and Target Instance */}
            <ColumnLayout columns={2}>
                <FormField label="Source Host" description="IP address or hostname of source server">
                    <Input
                        value={sourceHost}
                        onChange={({ detail }) => setSourceHost(detail.value)}
                        placeholder="10.0.1.50"
                        ariaLabel="Source host"
                    />
                </FormField>
                <FormField label="Target Instance ID" description="EC2 instance ID of the target server">
                    <Input
                        value={targetInstanceId}
                        onChange={({ detail }) => setTargetInstanceId(detail.value)}
                        placeholder="i-1234567890abcdef0"
                        ariaLabel="Target instance ID"
                    />
                </FormField>
            </ColumnLayout>

            {/* Target Account and Region */}
            <ColumnLayout columns={2}>
                <FormField label="Target Account" description="Select which AWS account the target instance resides in">
                    <Select
                        selectedOption={targetAccount}
                        onChange={({ detail }) => setTargetAccount(detail.selectedOption)}
                        options={accountOptions}
                        ariaLabel="Target account"
                    />
                </FormField>
                <FormField label="Target Region" description="AWS region where the target instance is located">
                    <Select
                        selectedOption={targetRegion}
                        onChange={({ detail }) => {
                            setTargetRegion(detail.selectedOption)
                            setCrossRegionAlertDismissed(false)
                        }}
                        options={AWS_REGION_OPTIONS}
                        filteringType="auto"
                        ariaLabel="Target region"
                    />
                </FormField>
            </ColumnLayout>

            {/* Cross-region prerequisite hint */}
            {isCrossRegion && !crossRegionAlertDismissed && (
                <Alert
                    type="info"
                    dismissible
                    onDismiss={() => setCrossRegionAlertDismissed(true)}
                >
                    Cross-region target ({targetRegion.value}): The SSM document and Secrets Manager secret (SSH key or credential) must exist in the target region before running this sync.
                </Alert>
            )}

            {/* Path Pairs */}
            <Container header={
                <Header
                    variant="h3"
                    actions={
                        <Button onClick={addPathPair} iconName="add-plus" ariaLabel="Add path pair">
                            Add Path
                        </Button>
                    }
                >
                    Sync Paths
                </Header>
            }>
                <SpaceBetween size="s">
                    {pathPairs.map((pair, index) => (
                        <SpaceBetween key={pair.id} size="xs">
                            <ColumnLayout columns={2}>
                                <FormField label={`Source Path ${index + 1}`}>
                                    <Input
                                        value={pair.sourcePath}
                                        onChange={({ detail }) => updatePathPair(index, 'sourcePath', detail.value)}
                                        placeholder="/data/app"
                                        ariaLabel={`Source path ${index + 1}`}
                                    />
                                </FormField>
                                <FormField
                                    label={`Target Path ${index + 1}`}
                                    secondaryControl={
                                        pathPairs.length > 1 ? (
                                            <Button
                                                onClick={() => removePathPair(index)}
                                                variant="icon"
                                                iconName="remove"
                                                ariaLabel={`Remove path pair ${index + 1}`}
                                            />
                                        ) : null
                                    }
                                >
                                    <Input
                                        value={pair.targetPath}
                                        onChange={({ detail }) => updatePathPair(index, 'targetPath', detail.value)}
                                        placeholder="/mnt/data/app"
                                        ariaLabel={`Target path ${index + 1}`}
                                    />
                                </FormField>
                            </ColumnLayout>
                        </SpaceBetween>
                    ))}
                </SpaceBetween>
            </Container>

            {/* Credential Type, Format, and ARN */}
            <ColumnLayout columns={3}>
                <FormField label="Credential Store">
                    <Select
                        selectedOption={credentialType}
                        onChange={({ detail }) => setCredentialType(detail.selectedOption)}
                        options={CREDENTIAL_TYPE_OPTIONS}
                        ariaLabel="Credential store"
                    />
                </FormField>
                <FormField label="Credential Format">
                    <RadioGroup
                        value={credentialFormat}
                        onChange={({ detail }) => setCredentialFormat(detail.value)}
                        items={[
                            { value: 'ssh-key', label: 'SSH Key' },
                            { value: 'username-password', label: 'Username/Password' },
                        ]}
                        ariaLabel="Credential format"
                    />
                </FormField>
                <FormField
                    label={credentialFormat === 'username-password' ? 'Credentials ARN' : 'SSH Key ARN'}
                    description={`${credentialType.label} ARN for ${credentialFormat === 'username-password' ? 'credentials' : 'SSH private key'}`}
                >
                    <Input
                        value={arnFocused || !sshKeyArn ? sshKeyArn : 'arn:***' + sshKeyArn.slice(-12)}
                        onChange={({ detail }) => {
                            if (detail.value.startsWith('arn:***')) return
                            setSshKeyArn(detail.value)
                        }}
                        onFocus={() => setArnFocused(true)}
                        onBlur={() => setArnFocused(false)}
                        placeholder={credentialFormat === 'username-password'
                            ? 'arn:aws:secretsmanager:us-east-1:123456789012:secret:credentials-abc123'
                            : 'arn:aws:secretsmanager:us-east-1:123456789012:secret:ssh-key-abc123'}
                        ariaLabel={credentialFormat === 'username-password' ? 'Credentials ARN' : 'SSH key ARN'}
                    />
                </FormField>
            </ColumnLayout>

            {targetAccount.value && (
                <Box variant="small" color="text-status-info">
                    Cross-Account Mode: Secret should be stored in Target Account ({targetAccount.label})
                </Box>
            )}

            {/* Advanced Options */}
            <Container header={<Header variant="h3">Advanced Options</Header>}>
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
                        <FormField label="Exclude Patterns" description="Comma-separated patterns to exclude from sync">
                            <Input
                                value={excludePatterns}
                                onChange={({ detail }) => setExcludePatterns(detail.value)}
                                placeholder="*.tmp,*.log,cache/*"
                                ariaLabel="Exclude patterns"
                            />
                        </FormField>
                    </ColumnLayout>

                    {isLinuxOrUnix && (
                        <FormField label="Transfer Engine">
                            <Select
                                selectedOption={transferEngine}
                                onChange={({ detail }) => setTransferEngine(detail.selectedOption)}
                                options={TRANSFER_ENGINE_OPTIONS}
                                ariaLabel="Transfer engine"
                            />
                        </FormField>
                    )}

                    {isLinuxOrUnix && transferEngine.value === 'rclone' && (
                        <Alert type="warning">
                            Experimental: rclone will be installed on the target instance if not present. This mode prioritizes speed over metadata fidelity. ACLs, extended attributes, and delta sync are not supported.
                        </Alert>
                    )}

                    {isLinuxOrUnix && isRsync && (
                        <ColumnLayout columns={2}>
                            <Checkbox
                                checked={preserveACL}
                                onChange={({ detail }) => setPreserveACL(detail.checked)}
                            >
                                Preserve ACLs (-A)
                            </Checkbox>
                            <Checkbox
                                checked={preserveXattrs}
                                onChange={({ detail }) => setPreserveXattrs(detail.checked)}
                            >
                                Preserve Extended Attributes (-X)
                            </Checkbox>
                        </ColumnLayout>
                    )}

                    <FormField label="Tags (Optional)" description="Comma-separated tags to organize and filter jobs">
                        <Input
                            value={jobTags}
                            onChange={({ detail }) => setJobTags(detail.value)}
                            placeholder="production, database, wave1"
                            ariaLabel="Job tags"
                        />
                    </FormField>
                </SpaceBetween>
            </Container>

            {/* Execution Schedule */}
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
                                <Input

                                    value={scheduleDate}
                                    onChange={({ detail }) => setScheduleDate(detail.value)}
                                    ariaLabel="Schedule date"
                                />
                            </FormField>
                            <FormField label={`Time (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                <Input

                                    value={scheduleTime}
                                    onChange={({ detail }) => setScheduleTime(detail.value)}
                                    ariaLabel="Schedule time"
                                />
                            </FormField>
                        </ColumnLayout>
                    )}
                    {executionMode === 'recurring' && (
                        <ColumnLayout columns={3}>
                            <FormField label={`Start Date (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                <Input

                                    value={recurringStartDate}
                                    onChange={({ detail }) => setRecurringStartDate(detail.value)}
                                    ariaLabel="Recurring start date"
                                />
                            </FormField>
                            <FormField label={`Start Time (${timezone === 'utc' ? 'UTC' : 'Local'})`}>
                                <Input

                                    value={recurringStartTime}
                                    onChange={({ detail }) => setRecurringStartTime(detail.value)}
                                    ariaLabel="Recurring start time"
                                />
                            </FormField>
                            <FormField label="Run for (days)">
                                <Input
                                    inputMode="numeric"
                                    value={recurringDays}
                                    onChange={({ detail }) => setRecurringDays(detail.value)}
                                    ariaLabel="Recurring days"
                                />
                            </FormField>
                        </ColumnLayout>
                    )}
                </SpaceBetween>
            </Container>

            {/* Alerts and Action Buttons */}
            {submitError && (
                <Alert type="error" dismissible onDismiss={() => setSubmitError('')}>
                    {submitError}
                </Alert>
            )}
            {submitSuccess && (
                <Alert type="success" dismissible onDismiss={() => setSubmitSuccess('')}>
                    {submitSuccess}
                </Alert>
            )}
            <SpaceBetween direction="horizontal" size="xs">
                <Button
                    onClick={handleValidate}
                    loading={validating}
                    disabled={!canSubmit}
                    variant="normal"
                >
                    Validate
                </Button>
                <Button
                    onClick={handleSubmit}
                    loading={submitting}
                    disabled={!canSubmit}
                    variant="primary"
                >
                    Start Sync
                </Button>
            </SpaceBetween>

            {/* Validation Results Modal */}
            <Modal
                visible={validationModalVisible}
                onDismiss={validationStatus === 'polling' || validationStatus === 'pending' ? undefined : () => setValidationModalVisible(false)}
                size="large"
                header="Validation Results"
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            {(validationStatus === 'completed' || validationStatus === 'failed' || validationStatus === 'timeout') && (
                                <Button onClick={() => setValidationModalVisible(false)}>Close</Button>
                            )}
                            {(validationStatus === 'pending' || validationStatus === 'polling') && (
                                <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>Validation in progress — please wait...</Box>
                            )}
                        </SpaceBetween>
                    </Box>
                }
            >
                <SpaceBetween size="m">
                    {validationStatus === 'pending' && (
                        <StatusIndicator type="loading">Starting validation...</StatusIndicator>
                    )}
                    {validationStatus === 'polling' && (
                        <StatusIndicator type="in-progress">Validation in progress. Checking connectivity, credentials, and paths...</StatusIndicator>
                    )}
                    {validationStatus === 'timeout' && (
                        <Alert type="warning">Validation is taking longer than expected. The check may still be running. Try again in a few minutes.</Alert>
                    )}
                    {validationStatus === 'failed' && (
                        <Alert type="error" header="Validation Failed">
                            {validationError}
                            {!!validationResults?.ssh_error && <Box variant="small" margin={{ top: 'xs' }}>SSH Error: {String(validationResults.ssh_error)}</Box>}
                            {!!validationResults?.smb_error && <Box variant="small" margin={{ top: 'xs' }}>SMB Error: {String(validationResults.smb_error)}</Box>}
                            {!!validationResults?.connectivity_error && <Box variant="small" margin={{ top: 'xs' }}>Connectivity: {String(validationResults.connectivity_error)}</Box>}
                        </Alert>
                    )}
                    {validationStatus === 'completed' && validationResults && <ValidationResultsDisplay results={validationResults} />}
                </SpaceBetween>
            </Modal>
        </SpaceBetween>
    )
}

// Extracted validation results display to keep the main component readable
function ValidationResultsDisplay({ results: r }: { results: Record<string, unknown> }) {
    const isSuccess = r.connectivity_status === 'SUCCESS' && r.space_check_status === 'SUFFICIENT' && r.os_compatible !== 'INCOMPATIBLE'
    const pathCount = parseInt(String(r.path_count)) || 1
    const isMultiPath = r.mode === 'MULTI_PATH' && pathCount > 1

    const pathRows: Array<{ path: string; filesystem: string; size: string; files: string; fsWarning: string; fsError: string }> = []
    for (let i = 0; i < pathCount; i++) {
        const pfx = `path_${i}_`
        const src = String(r[`${pfx}source`] || (i === 0 ? r.source_path : '') || '')
        const fs = String(r[`${pfx}source_fs_type`] || (i === 0 ? r.source_fs_type : '—') || '—')
        // R11.1, R11.2: prefer SOURCE_FILESYSTEM_USED_GB over legacy SOURCE_SIZE_GB
        const sizeGb = r[`${pfx}source_filesystem_used_gb`]
            || r[`${pfx}source_size_gb`]
            || (i === 0 ? (r.source_filesystem_used_gb || r.source_size_gb) : null)
        const fc = r[`${pfx}source_file_count`] || (i === 0 ? r.source_file_count : null)
        // R11.7, R11.8: per-pair filesystem warning and error rendered inline
        const fsWarning = String(r[`${pfx}source_fs_warning`] || (i === 0 ? r.source_fs_warning : '') || '')
        const fsError = String(r[`${pfx}source_fs_error`] || (i === 0 ? r.source_fs_error : '') || '')
        if (src) {
            pathRows.push({
                path: src,
                filesystem: fs,
                size: sizeGb ? `${sizeGb} GB` : '—',
                files: parseInt(String(fc)) ? parseInt(String(fc)).toLocaleString() : (String(fc || '—')),
                fsWarning,
                fsError,
            })
        }
    }

    // Time estimate is now Lambda-emitted (R12.1, R12.4): either an object with
    // conservative/moderate/optimistic hours, or the literal "Estimate
    // unavailable: missing filesystem size data" string when SOURCE_FILESYSTEM_USED_BYTES
    // is absent. Prefer the server-side estimate; fall back to client-side
    // computation only for older Lambda deployments that don't emit it yet.
    const estimate = r.time_estimate as Record<string, unknown> | string | undefined
    const hasServerEstimate = typeof estimate === 'object' && estimate !== null
    const isUnavailable = typeof estimate === 'string'
    const fmt = (h: number) => h < 0.1 ? '< 0.1' : h.toFixed(1)
    let h50: number, h100: number, h250: number
    if (hasServerEstimate) {
        h50 = Number((estimate as Record<string, unknown>).conservative_hours)
        h100 = Number((estimate as Record<string, unknown>).moderate_hours)
        h250 = Number((estimate as Record<string, unknown>).optimistic_hours)
    } else {
        const fallbackBytes = parseFloat(String(r.source_filesystem_used_bytes || r.total_source_size_bytes || r.source_size_bytes || 0))
        const adj = fallbackBytes * 1.15
        h50 = adj / 6250000 / 3600
        h100 = adj / 12500000 / 3600
        h250 = adj / 31250000 / 3600
    }
    const sourceSizeBytes = hasServerEstimate
        ? Number((estimate as Record<string, unknown>).source_filesystem_used_bytes)
        : parseFloat(String(r.source_filesystem_used_bytes || r.total_source_size_bytes || r.source_size_bytes || 0))

    return (
        <SpaceBetween size="m">
            <Alert type={isSuccess ? 'success' : 'warning'}>
                {isSuccess ? 'All checks passed. Ready to sync.' : 'Some checks need attention. Review the details below.'}
            </Alert>
            <Container header={<Header variant="h3">Connectivity</Header>}>
                <StatusIndicator type={r.connectivity_status === 'SUCCESS' ? 'success' : 'error'}>
                    {r.connectivity_status === 'SUCCESS' ? 'SSH connection successful' : String(r.ssh_error || r.smb_error || 'Connection failed')}
                </StatusIndicator>
            </Container>
            {!!(r.os_family || r.source_os_distro_family || r.target_os_distro_family || r.source_os_family || r.target_os_family) && (
                <Container header={<Header variant="h3">OS Compatibility</Header>}>
                    <ColumnLayout columns={2}>
                        <div>
                            <Box variant="awsui-key-label">Source OS</Box>
                            <Box>
                                {String(r.source_os_distro_family || r.os_family || r.source_os_family || 'Unknown')}
                                {(r.source_os_distro_version || r.os_version) ? ` ${String(r.source_os_distro_version || r.os_version)}` : ''}
                                {r.source_os_detail && !r.source_os_distro_family ? ` (${String(r.source_os_detail)})` : ''}
                            </Box>
                            {!!(r.source_os_distro_source || r.os_detection_source) && (
                                <Box variant="small" color="text-body-secondary">
                                    Detected via {String(r.source_os_distro_source || r.os_detection_source)}
                                </Box>
                            )}
                        </div>
                        <div>
                            <Box variant="awsui-key-label">Target OS</Box>
                            <Box>
                                {String(r.target_os_distro_family || r.target_os_family || 'Unknown')}
                                {r.target_os_distro_version ? ` ${String(r.target_os_distro_version)}` : ''}
                                {r.target_os_detail && !r.target_os_distro_family ? ` (${String(r.target_os_detail)})` : ''}
                            </Box>
                            {!!r.target_os_distro_source && (
                                <Box variant="small" color="text-body-secondary">
                                    Detected via {String(r.target_os_distro_source)}
                                </Box>
                            )}
                        </div>
                    </ColumnLayout>
                    <Box margin={{ top: 's' }}>
                        <StatusIndicator type={r.os_compatible === 'INCOMPATIBLE' ? 'error' : 'success'}>
                            {r.os_compatible === 'INCOMPATIBLE' ? String(r.os_mismatch_reason || 'OS mismatch') : 'Compatible'}
                        </StatusIndicator>
                    </Box>
                </Container>
            )}
            {pathRows.length > 0 && (
                <Container header={<Header variant="h3">Source Paths ({pathRows.length})</Header>}>
                    <Table
                        columnDefinitions={[
                            { id: 'path', header: 'Path', cell: (item) => item.path },
                            { id: 'filesystem', header: 'Filesystem', cell: (item) => item.filesystem },
                            {
                                id: 'size',
                                header: 'Source Filesystem Used',
                                cell: (item) => {
                                    // R11.6: render the new SOURCE_FILESYSTEM_USED label
                                    // R11.7: render SOURCE_FS_WARNING inline beside the value
                                    // R11.8: when SOURCE_FS_ERROR is set, surface it instead of the value
                                    if (item.fsError) {
                                        return <StatusIndicator type="error">{item.fsError}</StatusIndicator>
                                    }
                                    return (
                                        <SpaceBetween size="xxs">
                                            <Box>{item.size}</Box>
                                            {item.fsWarning && (
                                                <StatusIndicator type="warning">{item.fsWarning}</StatusIndicator>
                                            )}
                                        </SpaceBetween>
                                    )
                                },
                            },
                            { id: 'files', header: 'File Count', cell: (item) => item.files },
                        ]}
                        items={pathRows}
                        ariaLabels={{ tableLabel: 'Source paths' }}
                    />
                    {isMultiPath && !!(r.total_source_filesystem_used_gb || r.total_source_size_gb || r.total_source_file_count) && (
                        <Box margin={{ top: 's' }} variant="small">
                            Total: {String(r.total_source_filesystem_used_gb || r.total_source_size_gb)} GB across {parseInt(String(r.total_source_file_count || 0)).toLocaleString()} files
                        </Box>
                    )}
                </Container>
            )}
            <Container header={<Header variant="h3">Target Disk Space</Header>}>
                <ColumnLayout columns={2}>
                    <div><Box variant="awsui-key-label">Available Space</Box><Box>{String(r.target_avail_gb || r.target_space_gb || '—')} GB</Box></div>
                    <div><Box variant="awsui-key-label">Space Check</Box>
                        <StatusIndicator type={r.space_check_status === 'SUFFICIENT' ? 'success' : r.space_check_status === 'INSUFFICIENT' ? 'error' : 'info'}>
                            {r.space_check_status === 'SUFFICIENT' ? 'Sufficient space' : r.space_check_status === 'INSUFFICIENT' ? `Insufficient — need ${r.shortfall_gb || '?'} GB more` : String(r.space_check_status || 'Unknown')}
                        </StatusIndicator>
                    </div>
                </ColumnLayout>
                {!!(r.path_0_target_fs_type || r.target_fs_type) && (
                    <Box margin={{ top: 'xs' }} variant="small">Filesystem: {String(r.path_0_target_fs_type || r.target_fs_type)}</Box>
                )}
            </Container>
            {(sourceSizeBytes > 0 || isUnavailable) && (
                <Container header={<Header variant="h3">Estimated Migration Time</Header>}>
                    {isUnavailable ? (
                        <StatusIndicator type="info">{estimate as string}</StatusIndicator>
                    ) : (
                        <>
                            <ColumnLayout columns={3}>
                                <div style={{ textAlign: 'center' }}><Box variant="awsui-key-label">Conservative (50 Mbps)</Box><Box fontSize="heading-m">~{fmt(h50)} hours</Box></div>
                                <div style={{ textAlign: 'center' }}><Box variant="awsui-key-label">Moderate (100 Mbps)</Box><Box fontSize="heading-m">~{fmt(h100)} hours</Box></div>
                                <div style={{ textAlign: 'center' }}><Box variant="awsui-key-label">Optimistic (250 Mbps)</Box><Box fontSize="heading-m">~{fmt(h250)} hours</Box></div>
                            </ColumnLayout>
                            {hasServerEstimate && !!(estimate as Record<string, unknown>).source_fs_warning && (
                                <Box margin={{ top: 's' }}>
                                    <StatusIndicator type="warning">{String((estimate as Record<string, unknown>).source_fs_warning)}</StatusIndicator>
                                </Box>
                            )}
                            <Box margin={{ top: 'xs' }} variant="small" color="text-body-secondary">
                                Includes ~15% overhead for rsync metadata and SSH encryption. Actual time depends on network conditions, file sizes, and disk I/O.
                            </Box>
                        </>
                    )}
                </Container>
            )}
        </SpaceBetween>
    )
}
