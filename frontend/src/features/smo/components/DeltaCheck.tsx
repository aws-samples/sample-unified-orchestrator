import { useState, useRef, useEffect } from 'react'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Modal from '@cloudscape-design/components/modal'
import Alert from '@cloudscape-design/components/alert'
import type { SyncJob } from '../services/api'
import {
    runDeltaCheck,
    getSyncStatus,
    createSyncJob,
    deleteSyncJob,
    updateSyncJob,
} from '../services/api'
import { formatBytes } from '../utils/formatters'

interface DeltaCheckProps {
    job: SyncJob
    onClose: () => void
    asModal?: boolean
}

type Phase = 'idle' | 'starting' | 'polling' | 'done' | 'error'

export default function DeltaCheck({ job, onClose, asModal = false }: DeltaCheckProps) {
    const [phase, setPhase] = useState<Phase>('idle')
    const [error, setError] = useState<string | null>(null)
    const [hasChanges, setHasChanges] = useState(false)
    const [newFiles, setNewFiles] = useState(0)
    const [newBytes, setNewBytes] = useState(0)
    const [resyncing, setResyncing] = useState(false)
    const [resyncDone, setResyncDone] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const jobId = job.jobId
    const jobName = job.jobName || jobId

    // Clean up polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }
    }, [])

    // Auto-start delta check when job changes
    useEffect(() => {
        if (jobId) {
            handleRunCheck()
        }
    }, [jobId])

    async function handleRunCheck() {
        if (!jobId) return
        setPhase('starting')
        setError(null)
        setHasChanges(false)
        setNewFiles(0)
        setNewBytes(0)
        setResyncDone(false)

        try {
            const data = await runDeltaCheck(jobId)

            if (data.error) {
                setPhase('error')
                setError(data.error)
                return
            }

            const dryRunJobId = data.dryRunJobId
            if (!dryRunJobId) {
                setPhase('error')
                setError('No dry-run job ID returned from delta check')
                return
            }

            // Poll the dry-run job every 5s
            setPhase('polling')
            let attempts = 0
            const maxAttempts = 60

            pollRef.current = setInterval(async () => {
                attempts++
                try {
                    const status = await getSyncStatus(dryRunJobId)
                    if (status.status === 'COMPLETED') {
                        clearInterval(pollRef.current!)
                        pollRef.current = null
                        // Delta check response may include extra fields beyond SyncJob type
                        const extra = status as unknown as { hasChanges?: boolean; newFiles?: number; newBytes?: number }
                        setHasChanges(!!extra.hasChanges)
                        setNewFiles(extra.newFiles || 0)
                        setNewBytes(extra.newBytes || 0)
                        setPhase('done')
                        // Clean up dry-run job after delay
                        setTimeout(async () => {
                            try { await deleteSyncJob(dryRunJobId) } catch (e) { console.warn('Failed to delete dry-run job:', e) }
                        }, 2000)
                        // Update original job with delta check metadata
                        try {
                            await updateSyncJob(jobId, {
                                lastDeltaCheckAt: new Date().toISOString(),
                                lastDeltaCheckHasChanges: !!extra.hasChanges,
                                lastDeltaCheckNewFiles: extra.newFiles || 0,
                                lastDeltaCheckNewBytes: extra.newBytes || 0,
                            })
                        } catch (e) { console.warn('Failed to update delta check metadata:', e) }
                    } else if (['FAILED', 'ERROR', 'TIMED_OUT'].includes(status.status)) {
                        clearInterval(pollRef.current!)
                        pollRef.current = null
                        setPhase('error')
                        setError(status.errorMessage || `Dry-run job ${status.status}`)
                        setTimeout(async () => {
                            try { await deleteSyncJob(dryRunJobId) } catch (e) { console.warn('Failed to delete dry-run job:', e) }
                        }, 2000)
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollRef.current!)
                        pollRef.current = null
                        setPhase('error')
                        setError('Delta check timed out after 5 minutes')
                    }
                } catch (pollErr) {
                    if (attempts >= maxAttempts) {
                        clearInterval(pollRef.current!)
                        pollRef.current = null
                        setPhase('error')
                        setError((pollErr as Error).message || 'Failed to poll dry-run status')
                    }
                }
            }, 5000)
        } catch (err) {
            setPhase('error')
            setError((err as Error).message || 'Failed to start delta check')
        }
    }

    async function handleResync() {
        setResyncing(true)
        try {
            const payload = {
                jobName: `${job.jobName || 'Sync Job'} (Re-sync)`,
                operatingSystem: job.operatingSystem || 'Linux',
                sourceHost: job.sourceHost,
                targetInstanceId: job.targetInstanceId,
                sshKeyArn: job.sshKeyArn,
                pathPairs: job.pathPairs?.length
                    ? job.pathPairs
                    : [],
                ...(job.bandwidthLimit && { bandwidthLimit: job.bandwidthLimit }),
                ...(job.excludePatterns && { excludePatterns: job.excludePatterns }),
                ...(job.tags?.length && { tags: job.tags }),
                ...(job.targetAccountId && {
                    targetAccountId: job.targetAccountId,
                    targetAccountAlias: job.targetAccountAlias || '',
                }),
                ...(job.credentialType && { credentialType: job.credentialType }),
                ...(job.credentialFormat && { credentialFormat: job.credentialFormat }),
                ...(job.transferEngine && { transferEngine: job.transferEngine }),
            }
            await createSyncJob(payload)
            setResyncDone(true)
            onClose()
        } catch (err) {
            setError((err as Error).message || 'Failed to start resync')
        } finally {
            setResyncing(false)
        }
    }

    const content = (
        <SpaceBetween size="l">
            {phase === 'starting' && (
                <Box textAlign="center" padding="l">
                    <StatusIndicator type="loading">Starting delta check...</StatusIndicator>
                </Box>
            )}
            {phase === 'polling' && (
                <Box textAlign="center" padding="l">
                    <StatusIndicator type="in-progress">
                        Checking for changes (dry-run rsync)... This may take a moment for large datasets.
                    </StatusIndicator>
                </Box>
            )}

            {error && (
                <Alert type="error" dismissible onDismiss={() => setError(null)}>
                    {error}
                </Alert>
            )}

            {phase === 'done' && hasChanges && (
                <Alert type="info" header="Changes Detected">
                    Found {newFiles.toLocaleString()} new file(s) ({formatBytes(newBytes)}). Would you like to sync now?
                </Alert>
            )}

            {phase === 'done' && !hasChanges && (
                <Alert type="success" header="No Changes Detected">
                    All data is up to date. No new files to sync.
                </Alert>
            )}
        </SpaceBetween>
    )

    if (asModal) {
        return (
            <Modal
                visible
                onDismiss={onClose}
                size="large"
                header={`Delta Check — ${jobName}`}
                footer={
                    <Box float="right">
                        <SpaceBetween direction="horizontal" size="xs">
                            {(phase === 'done' || phase === 'error') && (
                                <Button onClick={handleRunCheck} variant="normal">Re-run Check</Button>
                            )}
                            {phase === 'done' && hasChanges && !resyncDone && (
                                <Button onClick={handleResync} loading={resyncing} variant="primary">Resync Now</Button>
                            )}
                            {phase !== 'starting' && phase !== 'polling' && (
                                <Button onClick={onClose}>Close</Button>
                            )}
                            {(phase === 'starting' || phase === 'polling') && (
                                <Button onClick={onClose} variant="link">Cancel</Button>
                            )}
                            {(phase === 'starting' || phase === 'polling') && (
                                <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
                                    Checking for changes...
                                </Box>
                            )}
                        </SpaceBetween>
                    </Box>
                }
            >
                {content}
            </Modal>
        )
    }

    return content
}
