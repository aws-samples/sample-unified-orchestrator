import { useState, useEffect, useRef } from 'react'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Modal from '@cloudscape-design/components/modal'
import type { SyncJob } from '../services/api'
import { getSyncLogs } from '../services/api'

interface LiveOutputProps {
    job: SyncJob
    onClose: () => void
    asModal?: boolean
}

const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'PROCESSING']

export default function LiveOutput({ job, onClose, asModal = false }: LiveOutputProps) {
    const [output, setOutput] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const outputRef = useRef<HTMLDivElement>(null)

    const jobId = job.jobId
    const jobName = job.jobName || jobId
    const isActive = ACTIVE_STATUSES.includes(job.status)

    useEffect(() => {
        if (!jobId) return
        setLoading(true)
        setOutput('')
        setError(null)

        // For active jobs, use job.liveOutput directly (updated by auto-refresh)
        if (isActive) {
            if (job.liveOutput?.trim()) {
                setOutput(job.liveOutput)
            }
            setLoading(false)
            return
        }

        // For completed/failed jobs, fetch from /logs endpoint
        async function fetchLogs() {
            try {
                if (job.liveOutput?.trim()) {
                    setOutput(job.liveOutput)
                    setLoading(false)
                    return
                }
                const data = await getSyncLogs(jobId)
                const text = Array.isArray(data.logs)
                    ? data.logs.join('\n')
                    : typeof data.logs === 'string'
                        ? data.logs
                        : JSON.stringify(data, null, 2)
                setOutput(text)
                setError(null)
            } catch (err) {
                setError((err as Error).message || 'Failed to fetch output')
            } finally {
                setLoading(false)
            }
        }

        fetchLogs()
    }, [jobId])

    // Update output from job.liveOutput when it changes (auto-refresh updates the job object)
    useEffect(() => {
        if (isActive && job.liveOutput?.trim()) {
            setOutput(job.liveOutput)
            setLoading(false)
        }
    }, [job.liveOutput, job.liveOutputUpdatedAt])

    // Auto-scroll to bottom
    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
    }, [output])

    // Prepend error banner for failed jobs
    const errorBanner =
        job.status === 'FAILED' && (job.errorSummary || job.errorMessage)
            ? `ERROR: ${job.errorSummary || job.errorMessage}${job.errorCategory ? ` [${job.errorCategory}]` : ''}\n\n`
            : ''

    const displayOutput = errorBanner + output

    const content = (
        <SpaceBetween size="s">
            {loading && <StatusIndicator type="loading">Loading output...</StatusIndicator>}
            {error && <StatusIndicator type="error">{error}</StatusIndicator>}
            {job.ssmCommandId && (
                <Box variant="small" color="text-body-secondary">
                    SSM Command: {job.ssmCommandId}
                </Box>
            )}
            <div
                ref={outputRef}
                style={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    background: '#1e1e1e',
                    color: '#d4d4d4',
                    padding: '12px',
                    borderRadius: '4px',
                    maxHeight: '500px',
                    overflowY: 'auto',
                    margin: 0,
                }}
            >
                {displayOutput || (loading ? '' : 'No output available.')}
            </div>
        </SpaceBetween>
    )

    if (asModal) {
        return (
            <Modal
                visible
                onDismiss={onClose}
                size="large"
                header={`Live Output — ${jobName}`}
                footer={
                    <Box float="right">
                        <Button variant="primary" onClick={onClose}>Close</Button>
                    </Box>
                }
            >
                {content}
            </Modal>
        )
    }

    return content
}
