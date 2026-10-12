import { useState, useEffect, useCallback, useRef } from 'react'
import {
    listSyncJobs,
    createSyncJob,
    updateSyncJob,
    deleteSyncJob,
    retrySyncJob,
    cancelSyncJob,
} from '../services/api'
import type { SyncJob, CreateJobParams } from '../services/api'

const REFRESH_INTERVAL = 5000

export interface UseJobsReturn {
    jobs: SyncJob[]
    loading: boolean
    error: string | null
    refreshJobs: () => Promise<void>
    createJob: (config: CreateJobParams) => Promise<SyncJob>
    updateJob: (jobId: string, updates: Partial<SyncJob>) => Promise<SyncJob>
    deleteJob: (jobId: string) => Promise<void>
    retryJob: (jobId: string) => Promise<SyncJob>
    cancelJob: (jobId: string) => Promise<SyncJob>
}

export function useJobs(): UseJobsReturn {
    const [jobs, setJobs] = useState<SyncJob[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const refreshJobs = useCallback(async () => {
        try {
            const data = await listSyncJobs()
            setJobs(Array.isArray(data) ? data : data.jobs ?? [])
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch jobs')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        refreshJobs()
        intervalRef.current = setInterval(refreshJobs, REFRESH_INTERVAL)
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [refreshJobs])

    const createJob = useCallback(
        async (config: CreateJobParams): Promise<SyncJob> => {
            const result = await createSyncJob(config)
            await refreshJobs()
            return result
        },
        [refreshJobs]
    )

    const updateJob = useCallback(
        async (jobId: string, updates: Partial<SyncJob>): Promise<SyncJob> => {
            const result = await updateSyncJob(jobId, updates)
            await refreshJobs()
            return result
        },
        [refreshJobs]
    )

    const deleteJob = useCallback(
        async (jobId: string): Promise<void> => {
            await deleteSyncJob(jobId)
            await refreshJobs()
        },
        [refreshJobs]
    )

    const retryJob = useCallback(
        async (jobId: string): Promise<SyncJob> => {
            const result = await retrySyncJob(jobId)
            await refreshJobs()
            return result
        },
        [refreshJobs]
    )

    const cancelJob = useCallback(
        async (jobId: string): Promise<SyncJob> => {
            const result = await cancelSyncJob(jobId)
            await refreshJobs()
            return result
        },
        [refreshJobs]
    )

    return { jobs, loading, error, refreshJobs, createJob, updateJob, deleteJob, retryJob, cancelJob }
}
