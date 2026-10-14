import { useState, useEffect, useCallback } from 'react'
import Table from '@cloudscape-design/components/table'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Header from '@cloudscape-design/components/header'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import Container from '@cloudscape-design/components/container'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Select from '@cloudscape-design/components/select'
import Toggle from '@cloudscape-design/components/toggle'
import DatePicker from '@cloudscape-design/components/date-picker'
import TimeInput from '@cloudscape-design/components/time-input'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import RadioGroup from '@cloudscape-design/components/radio-group'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import Badge from '@cloudscape-design/components/badge'
import {
    listSchedules, getSchedule, createSchedule, updateSchedule, deleteSchedule,
    listSyncJobs,
} from '../services/api'
import type { Schedule, SyncJob, CreateScheduleParams } from '../services/api'
import { formatCronExpression } from '../utils/cronUtils'

interface ScheduleFormProps {
    visible: boolean
}

interface SelectOption {
    label: string
    value: string
}

const OS_OPTIONS: SelectOption[] = [
    { label: 'Linux', value: 'Linux' },
    { label: 'Windows', value: 'Windows' },
]

const BANDWIDTH_OPTIONS: SelectOption[] = [
    { label: 'Unlimited', value: '' },
    { label: '10 MB/s', value: '10000' },
    { label: '50 MB/s', value: '50000' },
    { label: '100 MB/s', value: '100000' },
]

/** Safely format an ISO date string for display. */
function formatDate(dateStr: string | undefined | null): string {
    if (!dateStr) return '—'
    try {
        const d = new Date(dateStr)
        if (isNaN(d.getTime())) return '—'
        return d.toLocaleString()
    } catch {
        return '—'
    }
}

/**
 * Schedule management — view, create, edit, clone, and manage scheduled sync jobs.
 * Renders inline as a tab pane.
 */
export default function ScheduleForm({ visible = true }: ScheduleFormProps) {
    const [schedules, setSchedules] = useState<Schedule[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [deleting, setDeleting] = useState<string | null>(null)

    // Creation form state
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [scheduleName, setScheduleName] = useState('')
    const [scheduleType, setScheduleType] = useState<'once' | 'recurring'>('once')
    const [scheduleDate, setScheduleDate] = useState('')
    const [scheduleTime, setScheduleTime] = useState('')
    const [cronExpression, setCronExpression] = useState('')
    const [timezone, setTimezone] = useState('utc')
    const [enabled, setEnabled] = useState(true)
    const [creating, setCreating] = useState(false)
    const [createError, setCreateError] = useState('')
    const [createSuccess, setCreateSuccess] = useState('')

    // Edit mode state
    const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)

    // Job configuration for the schedule
    const [jobName, setJobName] = useState('')
    const [operatingSystem, setOperatingSystem] = useState<SelectOption>({ label: 'Linux', value: 'Linux' })
    const [sourceHost, setSourceHost] = useState('')
    const [targetInstanceId, setTargetInstanceId] = useState('')
    const [sshKeyArn, setSshKeyArn] = useState('')
    const [sourcePath, setSourcePath] = useState('')
    const [targetPath, setTargetPath] = useState('')
    const [bandwidthLimit, setBandwidthLimit] = useState<SelectOption>({ label: 'Unlimited', value: '' })
    const [excludePatterns, setExcludePatterns] = useState('')
    const [jobTags, setJobTags] = useState('')
    const [scheduleTargetRegion, setScheduleTargetRegion] = useState('')

    // Load from existing job
    const [existingJobs, setExistingJobs] = useState<SyncJob[]>([])
    const [selectedExistingJob, setSelectedExistingJob] = useState<SelectOption | null>(null)

    const loadSchedules = useCallback(async () => {
        try {
            setLoading(true)
            const data = await listSchedules()
            setSchedules(Array.isArray(data) ? data : (data as { schedules: Schedule[] }).schedules || [])
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch schedules')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (visible) loadSchedules()
    }, [visible, loadSchedules])

    // Load COMPLETED jobs for the "Load from Existing Job" dropdown
    useEffect(() => {
        if (visible && showCreateForm) {
            listSyncJobs()
                .then(data => {
                    const jobs = data.jobs || []
                    setExistingJobs(jobs.filter((j: SyncJob) => j.status === 'COMPLETED'))
                })
                .catch(() => { /* silently ignore */ })
        }
    }, [visible, showCreateForm])

    async function handleDelete(scheduleId: string) {
        setDeleting(scheduleId)
        try {
            await deleteSchedule(scheduleId)
            await loadSchedules()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete schedule')
        } finally {
            setDeleting(null)
        }
    }

    function handleLoadFromJob(detail: { selectedOption: SelectOption | null }) {
        const jobId = detail.selectedOption?.value
        setSelectedExistingJob(detail.selectedOption)
        if (!jobId) return
        const job = existingJobs.find(j => (j.jobId) === jobId)
        if (!job) return

        setJobName(job.jobName || '')
        setOperatingSystem(job.operatingSystem === 'Windows'
            ? { label: 'Windows', value: 'Windows' }
            : { label: 'Linux', value: 'Linux' })
        setSourceHost(job.sourceHost || '')
        setTargetInstanceId(job.targetInstanceId || '')
        setSshKeyArn(job.sshKeyArn || '')
        const firstPath = job.pathPairs?.[0] || { sourcePath: '', targetPath: '' }
        setSourcePath(firstPath.sourcePath || '')
        setTargetPath(firstPath.targetPath || '')
        setExcludePatterns(job.excludePatterns || '')
        setJobTags((job.tags || []).join(', '))
        setScheduleTargetRegion(job.targetRegion || '')
    }

    function resetCreateForm() {
        setScheduleName('')
        setScheduleType('once')
        setScheduleDate('')
        setScheduleTime('')
        setCronExpression('')
        setTimezone('utc')
        setEnabled(true)
        setJobName('')
        setOperatingSystem({ label: 'Linux', value: 'Linux' })
        setSourceHost('')
        setTargetInstanceId('')
        setSshKeyArn('')
        setSourcePath('')
        setTargetPath('')
        setBandwidthLimit({ label: 'Unlimited', value: '' })
        setExcludePatterns('')
        setJobTags('')
        setScheduleTargetRegion('')
        setSelectedExistingJob(null)
        setCreateError('')
        setCreateSuccess('')
        setEditingScheduleId(null)
    }

    /**
     * Populate form fields from a schedule object.
     * Used by both edit and clone flows.
     */
    function populateFormFromSchedule(schedule: Schedule) {
        setScheduleName(schedule.scheduleName || '')
        setEnabled(schedule.enabled !== false)

        const type = schedule.scheduleType || 'once'
        setScheduleType(type)

        const tz = schedule.timezone || 'UTC'
        setTimezone(tz === 'UTC' ? 'utc' : 'local')

        if (schedule.cronExpression) {
            const cronParts = schedule.cronExpression.split(' ')
            const minute = parseInt(cronParts[0])
            const hour = parseInt(cronParts[1])

            if (type === 'once') {
                const day = parseInt(cronParts[2])
                const month = parseInt(cronParts[3])
                const year = parseInt(cronParts[5])
                const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute))

                if (tz === 'UTC') {
                    setScheduleDate(utcDate.toISOString().split('T')[0])
                    setScheduleTime(
                        String(utcDate.getUTCHours()).padStart(2, '0') + ':' +
                        String(utcDate.getUTCMinutes()).padStart(2, '0')
                    )
                } else {
                    const localDate = new Date(utcDate.getTime())
                    const yr = localDate.getFullYear()
                    const mo = String(localDate.getMonth() + 1).padStart(2, '0')
                    const dy = String(localDate.getDate()).padStart(2, '0')
                    const hr = String(localDate.getHours()).padStart(2, '0')
                    const mn = String(localDate.getMinutes()).padStart(2, '0')
                    setScheduleDate(`${yr}-${mo}-${dy}`)
                    setScheduleTime(`${hr}:${mn}`)
                }
            } else {
                setCronExpression(schedule.cronExpression)
                const now = new Date()
                const utcDate = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute))
                if (tz === 'UTC') {
                    setScheduleTime(
                        String(utcDate.getUTCHours()).padStart(2, '0') + ':' +
                        String(utcDate.getUTCMinutes()).padStart(2, '0')
                    )
                } else {
                    const localDate = new Date(utcDate.getTime())
                    setScheduleTime(
                        String(localDate.getHours()).padStart(2, '0') + ':' +
                        String(localDate.getMinutes()).padStart(2, '0')
                    )
                }
            }
        }

        // Populate job template fields
        const jt = schedule.jobTemplate || {} as Record<string, unknown>
        setJobName((jt.jobName as string) || '')
        setOperatingSystem((jt.operatingSystem as string) === 'Windows'
            ? { label: 'Windows', value: 'Windows' }
            : { label: 'Linux', value: 'Linux' })
        setSourceHost((jt.sourceHost as string) || '')
        setTargetInstanceId((jt.targetInstanceId as string) || '')
        setSshKeyArn((jt.sshKeyArn as string) || '')
        const firstPath = jt.pathPairs?.[0] || { sourcePath: '', targetPath: '' }
        setSourcePath(firstPath.sourcePath || '')
        setTargetPath(firstPath.targetPath || '')
        const bwMatch = BANDWIDTH_OPTIONS.find(o => o.value === (jt.bandwidthLimit || ''))
        setBandwidthLimit(bwMatch || { label: 'Unlimited', value: '' })
        setExcludePatterns((jt.excludePatterns as string) || '')
        setJobTags((jt.tags || []).join(', '))
        setScheduleTargetRegion((jt.targetRegion as string) || '')
    }

    /** Edit an existing schedule — fetch and populate form in edit mode. */
    async function handleEdit(scheduleId: string) {
        try {
            setCreateError('')
            const schedule = await getSchedule(scheduleId)
            populateFormFromSchedule(schedule)
            setEditingScheduleId(scheduleId)
            setShowCreateForm(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load schedule for editing')
        }
    }

    /** Clone a schedule — fetch and populate form as a new schedule. */
    async function handleClone(scheduleId: string) {
        try {
            setCreateError('')
            const schedule = await getSchedule(scheduleId)
            populateFormFromSchedule(schedule)

            setScheduleName((schedule.scheduleName || '') + ' (Copy)')

            // Set date to tomorrow, time to 02:00
            const tomorrow = new Date()
            tomorrow.setDate(tomorrow.getDate() + 1)
            const yr = tomorrow.getFullYear()
            const mo = String(tomorrow.getMonth() + 1).padStart(2, '0')
            const dy = String(tomorrow.getDate()).padStart(2, '0')
            setScheduleDate(`${yr}-${mo}-${dy}`)
            setScheduleTime('02:00')

            // Clone creates a new schedule, not a PATCH
            setEditingScheduleId(null)
            setShowCreateForm(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load schedule for cloning')
        }
    }

    /** Toggle a schedule's enabled state. */
    async function handleToggle(scheduleId: string, newEnabled: boolean) {
        try {
            await updateSchedule(scheduleId, { enabled: newEnabled } as Partial<CreateScheduleParams>)
            setCreateSuccess('Schedule ' + (newEnabled ? 'enabled' : 'disabled') + ' successfully')
            await loadSchedules()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to toggle schedule')
        }
    }

    /** Create or update a schedule depending on edit mode. */
    async function handleCreateSchedule() {
        if (!scheduleName.trim()) {
            setCreateError('Schedule name is required')
            return
        }
        setCreating(true)
        setCreateError('')
        setCreateSuccess('')

        try {
            const tagsArray = jobTags.trim()
                ? jobTags.split(',').map(t => t.trim()).filter(Boolean)
                : []

            const payload: Record<string, unknown> = {
                scheduleName: scheduleName.trim(),
                enabled,
                timezone,
                jobTemplate: {
                    jobName: jobName.trim() || scheduleName.trim(),
                    operatingSystem: operatingSystem.value,
                    sourceHost: sourceHost.trim(),
                    targetInstanceId: targetInstanceId.trim(),
                    sshKeyArn: sshKeyArn.trim(),
                    pathPairs: [{ sourcePath: sourcePath.trim(), targetPath: targetPath.trim() }],
                    ...(bandwidthLimit.value && { bandwidthLimit: bandwidthLimit.value }),
                    ...(excludePatterns.trim() && { excludePatterns: excludePatterns.trim() }),
                    ...(tagsArray.length > 0 && { tags: tagsArray }),
                    ...(scheduleTargetRegion && { targetRegion: scheduleTargetRegion }),
                },
            }

            if (scheduleType === 'once') {
                let dateTime: Date
                if (timezone === 'local') {
                    const [yr, mo, dy] = scheduleDate.split('-').map(Number)
                    const [hr, mn] = scheduleTime.split(':').map(Number)
                    dateTime = new Date(yr, mo - 1, dy, hr, mn, 0)
                } else {
                    dateTime = new Date(scheduleDate + 'T' + scheduleTime + ':00Z')
                }
                const minute = dateTime.getUTCMinutes()
                const hour = dateTime.getUTCHours()
                const day = dateTime.getUTCDate()
                const month = dateTime.getUTCMonth() + 1
                const year = dateTime.getUTCFullYear()
                payload.cronExpression = `${minute} ${hour} ${day} ${month} ? ${year}`
                payload.scheduleType = 'once'
            } else {
                payload.cronExpression = cronExpression.trim()
                payload.scheduleType = 'recurring'
            }

            if (editingScheduleId) {
                await updateSchedule(editingScheduleId, payload as unknown as Partial<CreateScheduleParams>)
                setCreateSuccess('Schedule updated successfully')
            } else {
                await createSchedule(payload as unknown as CreateScheduleParams)
                setCreateSuccess('Schedule created successfully')
            }

            await loadSchedules()
            resetCreateForm()
            setShowCreateForm(false)
        } catch (err) {
            setCreateError(err instanceof Error ? err.message : 'Failed to save schedule')
        } finally {
            setCreating(false)
        }
    }

    const existingJobOptions: SelectOption[] = existingJobs.map(j => ({
        label: j.jobName || j.jobId,
        value: j.jobId,
    }))

    const columnDefinitions = [
        {
            id: 'name',
            header: 'Name',
            cell: (item: Schedule) => item.scheduleName || '—',
            sortingField: 'scheduleName',
        },
        {
            id: 'nextRun',
            header: 'Next Run',
            cell: (item: Schedule) => {
                const type = item.scheduleType || 'recurring'
                const tz = item.timezone || 'UTC'
                return formatCronExpression(item.cronExpression, tz, type)
            },
        },
        {
            id: 'status',
            header: 'Status',
            cell: (item: Schedule) => {
                const isOneTime = (item.scheduleType || 'recurring') === 'once'
                const isCompleted = isOneTime && (item.runCount || 0) > 0
                if (isCompleted) {
                    return <StatusIndicator type="success">Completed</StatusIndicator>
                }
                const isEnabled = item.enabled !== false
                return (
                    <StatusIndicator type={isEnabled ? 'success' : 'stopped'}>
                        {isEnabled ? 'Enabled' : 'Disabled'}
                    </StatusIndicator>
                )
            },
        },
        {
            id: 'runs',
            header: 'Runs',
            cell: (item: Schedule) => (
                <SpaceBetween size="xxs" direction="vertical">
                    <Box variant="small">Runs: {item.runCount || 0}</Box>
                    {item.lastRunAt ? (
                        <Box variant="small">Last: {formatDate(item.lastRunAt)}</Box>
                    ) : null}
                    <Box variant="small">Updated: {formatDate(item.updatedAt)}</Box>
                    {item.clonedFrom ? <Badge>Cloned</Badge> : null}
                </SpaceBetween>
            ),
        },
        {
            id: 'actions',
            header: 'Actions',
            cell: (item: Schedule) => {
                const scheduleId = item.scheduleId
                const isOneTime = (item.scheduleType || 'recurring') === 'once'
                const hasRun = (item.runCount || 0) > 0
                const showToggle = !(isOneTime && hasRun)
                const isEnabled = item.enabled !== false

                return (
                    <SpaceBetween direction="horizontal" size="xxs">
                        <Button
                            variant="icon"
                            iconName="edit"
                            ariaLabel={'Edit schedule ' + (item.scheduleName || scheduleId)}
                            onClick={() => handleEdit(scheduleId)}
                        />
                        <Button
                            variant="icon"
                            iconName="copy"
                            ariaLabel={'Clone schedule ' + (item.scheduleName || scheduleId)}
                            onClick={() => handleClone(scheduleId)}
                        />
                        {showToggle ? (
                            <Button
                                variant="normal"
                                onClick={() => handleToggle(scheduleId, !isEnabled)}
                            >
                                {isEnabled ? 'Disable' : 'Enable'}
                            </Button>
                        ) : null}
                        <Button
                            variant="icon"
                            iconName="remove"
                            ariaLabel={'Delete schedule ' + (item.scheduleName || scheduleId)}
                            loading={deleting === scheduleId}
                            onClick={() => handleDelete(scheduleId)}
                        />
                    </SpaceBetween>
                )
            },
        },
    ]

    if (!visible) return null

    return (
        <SpaceBetween size="l">
            {error && (
                <Alert type="error" dismissible onDismiss={() => setError(null)}>
                    {error}
                </Alert>
            )}
            {createSuccess && (
                <Alert type="success" dismissible onDismiss={() => setCreateSuccess('')}>
                    {createSuccess}
                </Alert>
            )}

            {/* Schedule Creation / Edit Form */}
            {showCreateForm ? (
                <Container header={<Header variant="h3">{editingScheduleId ? 'Edit Schedule' : 'Create Schedule'}</Header>}>
                    <SpaceBetween size="m">
                        {createError && (
                            <Alert type="error" dismissible onDismiss={() => setCreateError('')}>
                                {createError}
                            </Alert>
                        )}

                        {/* Load from existing job */}
                        <FormField label="Load from Existing Job" description="Pre-fill configuration from an existing sync job">
                            <Select
                                selectedOption={selectedExistingJob}
                                onChange={({ detail }) => handleLoadFromJob(detail as { selectedOption: SelectOption | null })}
                                options={existingJobOptions}
                                placeholder="Select a job to load..."
                                ariaLabel="Load from existing job"
                            />
                        </FormField>

                        <ColumnLayout columns={2}>
                            <FormField label="Schedule Name">
                                <Input
                                    value={scheduleName}
                                    onChange={({ detail }) => setScheduleName(detail.value)}
                                    placeholder="Nightly DB Sync"
                                    ariaLabel="Schedule name"
                                />
                            </FormField>
                            <FormField label="Schedule Type">
                                <RadioGroup
                                    value={scheduleType}
                                    onChange={({ detail }) => setScheduleType(detail.value as 'once' | 'recurring')}
                                    items={[
                                        { value: 'once', label: 'Run Once' },
                                        { value: 'recurring', label: 'Recurring' },
                                    ]}
                                    ariaLabel="Schedule type"
                                />
                            </FormField>
                        </ColumnLayout>

                        <FormField label="Timezone">
                            <RadioGroup
                                value={timezone}
                                onChange={({ detail }) => setTimezone(detail.value)}
                                items={[
                                    { value: 'utc', label: 'UTC' },
                                    { value: 'local', label: 'Local' },
                                ]}
                                ariaLabel="Timezone"
                            />
                        </FormField>

                        {scheduleType === 'once' && (
                            <ColumnLayout columns={2}>
                                <FormField label={'Date (' + (timezone === 'utc' ? 'UTC' : 'Local') + ')'}>
                                    <DatePicker
                                        value={scheduleDate}
                                        onChange={({ detail }) => setScheduleDate(detail.value)}
                                        placeholder="YYYY/MM/DD"
                                    />
                                </FormField>
                                <FormField label={'Time (' + (timezone === 'utc' ? 'UTC' : 'Local') + ')'}>
                                    <TimeInput
                                        value={scheduleTime}
                                        onChange={({ detail }) => setScheduleTime(detail.value)}
                                        format="hh:mm"
                                        placeholder="hh:mm"
                                    />
                                </FormField>
                            </ColumnLayout>
                        )}

                        {scheduleType === 'recurring' && (
                            <FormField label="Cron Expression" description="e.g. cron(0 2 * * ? *)">
                                <Input
                                    value={cronExpression}
                                    onChange={({ detail }) => setCronExpression(detail.value)}
                                    placeholder="cron(0 2 * * ? *)"
                                    ariaLabel="Cron expression"
                                />
                            </FormField>
                        )}

                        <Toggle
                            checked={enabled}
                            onChange={({ detail }) => setEnabled(detail.checked)}
                        >
                            Enabled
                        </Toggle>

                        {/* Job Configuration */}
                        <ExpandableSection headerText="Job Configuration" defaultExpanded>
                            <SpaceBetween size="m">
                                <ColumnLayout columns={2}>
                                    <FormField label="Job Name">
                                        <Input
                                            value={jobName}
                                            onChange={({ detail }) => setJobName(detail.value)}
                                            placeholder="Sync Job Name"
                                            ariaLabel="Job name"
                                        />
                                    </FormField>
                                    <FormField label="Operating System">
                                        <Select
                                            selectedOption={operatingSystem}
                                            onChange={({ detail }) => setOperatingSystem(detail.selectedOption as SelectOption)}
                                            options={OS_OPTIONS}
                                            ariaLabel="Operating system"
                                        />
                                    </FormField>
                                </ColumnLayout>
                                <ColumnLayout columns={2}>
                                    <FormField label="Source Host">
                                        <Input
                                            value={sourceHost}
                                            onChange={({ detail }) => setSourceHost(detail.value)}
                                            placeholder="10.0.1.50"
                                            ariaLabel="Source host"
                                        />
                                    </FormField>
                                    <FormField label="Target Instance ID">
                                        <Input
                                            value={targetInstanceId}
                                            onChange={({ detail }) => setTargetInstanceId(detail.value)}
                                            placeholder="i-1234567890abcdef0"
                                            ariaLabel="Target instance ID"
                                        />
                                    </FormField>
                                </ColumnLayout>
                                <FormField label="Credential ARN">
                                    <Input
                                        value={sshKeyArn}
                                        onChange={({ detail }) => setSshKeyArn(detail.value)}
                                        placeholder="arn:aws:secretsmanager:us-east-1:123456789012:secret:ssh-key"
                                        ariaLabel="Credential ARN"
                                    />
                                </FormField>
                                <ColumnLayout columns={2}>
                                    <FormField label="Source Path">
                                        <Input
                                            value={sourcePath}
                                            onChange={({ detail }) => setSourcePath(detail.value)}
                                            placeholder="/data/app"
                                            ariaLabel="Source path"
                                        />
                                    </FormField>
                                    <FormField label="Target Path">
                                        <Input
                                            value={targetPath}
                                            onChange={({ detail }) => setTargetPath(detail.value)}
                                            placeholder="/mnt/data/app"
                                            ariaLabel="Target path"
                                        />
                                    </FormField>
                                </ColumnLayout>
                                <ColumnLayout columns={2}>
                                    <FormField label="Bandwidth Limit">
                                        <Select
                                            selectedOption={bandwidthLimit}
                                            onChange={({ detail }) => setBandwidthLimit(detail.selectedOption as SelectOption)}
                                            options={BANDWIDTH_OPTIONS}
                                            ariaLabel="Bandwidth limit"
                                        />
                                    </FormField>
                                    <FormField label="Exclude Patterns">
                                        <Input
                                            value={excludePatterns}
                                            onChange={({ detail }) => setExcludePatterns(detail.value)}
                                            placeholder="*.tmp,*.log"
                                            ariaLabel="Exclude patterns"
                                        />
                                    </FormField>
                                </ColumnLayout>
                                <FormField label="Tags">
                                    <Input
                                        value={jobTags}
                                        onChange={({ detail }) => setJobTags(detail.value)}
                                        placeholder="production, wave1"
                                        ariaLabel="Tags"
                                    />
                                </FormField>
                            </SpaceBetween>
                        </ExpandableSection>

                        <SpaceBetween direction="horizontal" size="xs">
                            <Button
                                variant="primary"
                                onClick={handleCreateSchedule}
                                loading={creating}
                            >
                                {editingScheduleId ? 'Save Changes' : 'Create Schedule'}
                            </Button>
                            <Button
                                variant="normal"
                                onClick={() => { resetCreateForm(); setShowCreateForm(false) }}
                            >
                                Cancel
                            </Button>
                        </SpaceBetween>
                    </SpaceBetween>
                </Container>
            ) : (
                <Box>
                    <Button variant="primary" onClick={() => setShowCreateForm(true)}>
                        Create Schedule
                    </Button>
                </Box>
            )}

            {/* Existing Schedules Table */}
            <Table
                columnDefinitions={columnDefinitions}
                items={schedules}
                loading={loading}
                loadingText="Loading schedules..."
                header={
                    <Header
                        counter={'(' + schedules.length + ')'}
                        actions={
                            <Button iconName="refresh" ariaLabel="Refresh schedules" onClick={loadSchedules} />
                        }
                    >
                        Scheduled Jobs
                    </Header>
                }
                empty={
                    <Box textAlign="center" color="inherit" padding="l">
                        <b>No schedules found</b>
                        <Box variant="p" color="inherit">
                            Create a schedule above to get started.
                        </Box>
                    </Box>
                }
                ariaLabels={{ tableLabel: 'Scheduled jobs table' }}
            />
        </SpaceBetween>
    )
}
