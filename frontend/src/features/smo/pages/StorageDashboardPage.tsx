import { useState, useCallback, useEffect, type ReactNode } from 'react'
import ContentLayout from '@cloudscape-design/components/content-layout'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Flashbar, { FlashbarProps } from '@cloudscape-design/components/flashbar'
import Tabs from '@cloudscape-design/components/tabs'
import Button from '@cloudscape-design/components/button'
import Box from '@cloudscape-design/components/box'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import Modal from '@cloudscape-design/components/modal'
import Badge from '@cloudscape-design/components/badge'
import { useJobs } from '../hooks/useJobs'
import { useSmoAuth } from '../hooks/useSmoAuth'
import { listAccounts } from '../services/api'
import type { SyncJob, CreateJobParams, Account } from '../services/api'
import type { UiSection } from '../services/rbac'
import JobStats from '../components/JobStats'
import CreateJobForm from '../components/CreateJobForm'
import JobTable from '../components/JobTable'
import ScheduleForm from '../components/ScheduleForm'
import AccountManager from '../components/AccountManager'
import BulkImport from '../components/BulkImport'
import LiveOutput from '../components/LiveOutput'
import DeltaCheck from '../components/DeltaCheck'
import HelpContent from '../components/HelpContent'
import ErrorBoundary from '../components/ErrorBoundary'

export default function StorageDashboardPage() {
    const { visibleSections, loading: authLoading, smoRole } = useSmoAuth()
    const {
        jobs, loading: jobsLoading, error: jobsError,
        refreshJobs, createJob, updateJob, deleteJob, retryJob, cancelJob,
    } = useJobs()

    const [notifications, setNotifications] = useState<FlashbarProps.MessageDefinition[]>([])
    const [activeJobTab, setActiveJobTab] = useState('active-jobs')
    const [cloneSource, setCloneSource] = useState<SyncJob | null>(null)

    // Modal visibility
    const [showAccountManager, setShowAccountManager] = useState(false)
    const [showBulkImport, setShowBulkImport] = useState(false)
    const [logsJob, setLogsJob] = useState<SyncJob | null>(null)
    const [deltaJob, setDeltaJob] = useState<SyncJob | null>(null)

    // Deployment mode detection
    const [deploymentMode, setDeploymentMode] = useState<'same-account' | 'cross-account' | null>(null)
    const [registeredAccounts, setRegisteredAccounts] = useState<Account[]>([])

    // Dismissible alert tracking
    const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())

    const canSee = (section: string) => visibleSections.includes(section as UiSection)

    // Detect deployment mode from registered accounts
    useEffect(() => {
        listAccounts()
            .then((data) => {
                const accts = data.accounts || []
                setRegisteredAccounts(accts)
                setDeploymentMode(accts.length > 0 ? 'cross-account' : 'same-account')
            })
            .catch(() => setDeploymentMode('same-account'))
    }, [])

    // ── Notification helpers ──

    const addNotification = useCallback((type: FlashbarProps.Type, content: string) => {
        const id = `${Date.now()}-${Math.random()}`
        setNotifications((prev) => [
            ...prev,
            {
                type,
                content,
                id,
                dismissible: true,
                onDismiss: () =>
                    setNotifications((curr) => curr.filter((n) => n.id !== id)),
            },
        ])
    }, [])

    // ── Job action handlers ──

    const handleCreateJob = useCallback(
        async (config: CreateJobParams) => {
            try {
                const result = await createJob(config)
                addNotification('success', 'Sync job created successfully.')
                setCloneSource(null)
                return result
            } catch (err) {
                addNotification('error', `Failed to create job: ${(err as Error).message}`)
                throw err
            }
        },
        [createJob, addNotification]
    )

    const handleUpdateJob = useCallback(
        async (jobId: string, updates: Partial<SyncJob>) => {
            try {
                return await updateJob(jobId, updates)
            } catch (err) {
                addNotification('error', `Failed to update job: ${(err as Error).message}`)
                throw err
            }
        },
        [updateJob, addNotification]
    )

    const handleDeleteJob = useCallback(
        async (jobId: string) => {
            try {
                await deleteJob(jobId)
                addNotification('success', 'Job deleted.')
            } catch (err) {
                addNotification('error', `Failed to delete job: ${(err as Error).message}`)
            }
        },
        [deleteJob, addNotification]
    )

    const handleRetryJob = useCallback(
        async (jobId: string) => {
            try {
                await retryJob(jobId)
                addNotification('success', 'Job retry initiated.')
            } catch (err) {
                addNotification('error', `Failed to retry job: ${(err as Error).message}`)
            }
        },
        [retryJob, addNotification]
    )

    const handleCancelJob = useCallback(
        async (jobId: string) => {
            try {
                await cancelJob(jobId)
                addNotification('success', 'Job cancellation requested.')
            } catch (err) {
                addNotification('error', `Failed to cancel job: ${(err as Error).message}`)
            }
        },
        [cancelJob, addNotification]
    )

    // ── Job selection handler (clone, delta, logs) ──

    const handleSelectJob = useCallback(
        (job: SyncJob, mode: 'clone' | 'delta' | 'logs') => {
            if (mode === 'clone') {
                setCloneSource({ ...job })
                addNotification(
                    'info',
                    `Cloned settings from "${job.jobName || job.jobId}" into the Advanced tab.`
                )
                window.scrollTo({ top: 0, behavior: 'smooth' })
                return
            }
            if (mode === 'delta') {
                setDeltaJob(job)
                return
            }
            if (mode === 'logs') {
                setLogsJob(job)
                return
            }
        },
        [addNotification]
    )

    // ── CSV template download ──

    function handleDownloadTemplate() {
        const cols =
            'jobName,sourceHost,targetInstanceId,sshKeyArn,sourcePath,targetPath,operatingSystem,targetAccountAlias,bandwidthLimit,excludePatterns,tags,credentialType,credentialFormat,transferEngine,targetRegion'
        const example =
            'My Sync Job,10.0.1.100,i-0abc123def456,arn:aws:secretsmanager:us-east-1:123456789012:secret:my-ssh-key,/data/app,/mnt/data/app,Linux,my-target-account,0,,,secretsmanager,sshkey,rsync,us-east-1'
        const blob = new Blob([cols + '\n' + example + '\n'], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'sync-jobs-template.csv'
        a.click()
        URL.revokeObjectURL(url)
    }

    // ── Alert banners ──

    const alertBanners: ReactNode[] = []

    const failedUnretried = jobs.filter(
        (j) =>
            ['FAILED', 'ERROR'].includes(j.status) &&
            (!j.retryCount || j.retryCount === 0)
    )
    const retryKey = `retry-${failedUnretried.length}`
    if (failedUnretried.length > 0 && !dismissedAlerts.has(retryKey)) {
        alertBanners.push(
            <Alert
                key={retryKey}
                type="info"
                dismissible
                onDismiss={() =>
                    setDismissedAlerts((prev) => new Set([...prev, retryKey]))
                }
            >
                {failedUnretried.length} failed job
                {failedUnretried.length > 1 ? 's have' : ' has'} not been retried.
                Consider retrying them.
            </Alert>
        )
    }

    const mismatchKey = 'mode-mismatch'
    if (
        deploymentMode === 'same-account' &&
        jobs.some((j) => j.targetAccountId || j.targetAccountAlias) &&
        !dismissedAlerts.has(mismatchKey)
    ) {
        alertBanners.push(
            <Alert
                key={mismatchKey}
                type="info"
                dismissible
                onDismiss={() =>
                    setDismissedAlerts((prev) => new Set([...prev, mismatchKey]))
                }
            >
                Cross-account jobs detected but deployment is in Same Account mode.
                Register target accounts via Manage Accounts.
            </Alert>
        )
    }

    // No SMO role assigned — show access denied
    if (!authLoading && !smoRole && visibleSections.length === 0) {
        return (
            <ContentLayout
                header={<Header variant="h1">Storage Migration Orchestrator</Header>}
            >
                <Alert type="error" header="Access Denied">
                    You do not have an SMO role assigned. Contact your administrator to be added to a Storage Migration Orchestrator group (SuperAdmin, MigrationAdmin, or MigrationEngineer).
                </Alert>
            </ContentLayout>
        )
    }

    const [showHelp, setShowHelp] = useState(false)

    return (
        <ContentLayout
            header={
                <Header
                    variant="h1"
                    actions={
                        <SpaceBetween direction="horizontal" size="xs">
                            {smoRole && (
                                <Badge color={
                                    smoRole === 'SuperAdmin' ? 'red'
                                        : smoRole === 'MigrationAdmin' ? 'blue'
                                            : 'green'
                                }>
                                    {smoRole}
                                </Badge>
                            )}
                            <Button iconName="status-info" variant="icon" ariaLabel="Help" onClick={() => setShowHelp(true)} />
                        </SpaceBetween>
                    }
                >
                    Storage Migration Orchestrator
                </Header>
            }
        >
            <ErrorBoundary>
                <SpaceBetween size="l">
                    <Flashbar items={notifications} />

                    {jobsError && (
                        <Flashbar
                            items={[
                                {
                                    type: 'error',
                                    content: jobsError,
                                    dismissible: false,
                                    id: 'jobs-poll-error',
                                },
                            ]}
                        />
                    )}

                    {alertBanners}

                    {/* Deployment mode indicator */}
                    {deploymentMode && (
                        <StatusIndicator
                            type={deploymentMode === 'cross-account' ? 'info' : 'stopped'}
                        >
                            {deploymentMode === 'cross-account'
                                ? 'Cross-Account Mode'
                                : 'Same Account Mode'}
                        </StatusIndicator>
                    )}

                    {/* Action bar */}
                    <SpaceBetween direction="horizontal" size="xs">
                        {canSee('bulkImport') && (
                            <Button iconName="download" onClick={handleDownloadTemplate}>
                                Download Template
                            </Button>
                        )}
                        {canSee('bulkImport') && (
                            <Button iconName="upload" onClick={() => setShowBulkImport(true)}>
                                Bulk Sync (CSV)
                            </Button>
                        )}
                        {canSee('accountManager') && (
                            <Button iconName="settings" onClick={() => setShowAccountManager(true)}>
                                Manage Accounts
                            </Button>
                        )}
                    </SpaceBetween>

                    <JobStats jobs={jobs} />

                    {canSee('createJob') && (
                        <CreateJobForm
                            onCreateJob={handleCreateJob}
                            cloneSource={cloneSource}
                            jobs={jobs}
                        />
                    )}

                    <Tabs
                        activeTabId={activeJobTab}
                        onChange={({ detail }) => setActiveJobTab(detail.activeTabId)}
                        tabs={[
                            {
                                label: 'Active Jobs',
                                id: 'active-jobs',
                                content: canSee('jobTable') ? (
                                    <JobTable
                                        jobs={jobs}
                                        loading={jobsLoading}
                                        onUpdateJob={handleUpdateJob}
                                        onDeleteJob={handleDeleteJob}
                                        onRetryJob={handleRetryJob}
                                        onCancelJob={handleCancelJob}
                                        onSelectJob={handleSelectJob}
                                        onRefresh={refreshJobs}
                                        onExport={() =>
                                            addNotification('info', 'Export coming soon.')
                                        }
                                    />
                                ) : (
                                    <Box padding="l">No access.</Box>
                                ),
                            },
                            {
                                label: 'Scheduled Jobs',
                                id: 'scheduled-jobs',
                                content: (
                                    <ScheduleForm
                                        visible={activeJobTab === 'scheduled-jobs'}
                                    />
                                ),
                            },
                        ]}
                    />

                    {/* Modals */}
                    <AccountManager
                        visible={showAccountManager}
                        onDismiss={() => setShowAccountManager(false)}
                    />

                    <Modal
                        visible={showBulkImport}
                        onDismiss={() => setShowBulkImport(false)}
                        size="large"
                        header="Bulk Sync Import (CSV)"
                    >
                        <BulkImport
                            onCreateJob={handleCreateJob}
                            accounts={registeredAccounts}
                        />
                    </Modal>

                    {deltaJob && (
                        <DeltaCheck
                            job={deltaJob}
                            onClose={() => setDeltaJob(null)}
                            asModal
                        />
                    )}

                    {logsJob && (
                        <LiveOutput
                            job={logsJob}
                            onClose={() => setLogsJob(null)}
                            asModal
                        />
                    )}

                    <Modal
                        visible={showHelp}
                        onDismiss={() => setShowHelp(false)}
                        size="medium"
                        header="Help"
                    >
                        <HelpContent context="general" />
                    </Modal>
                </SpaceBetween>
            </ErrorBoundary>
        </ContentLayout>
    )
}
