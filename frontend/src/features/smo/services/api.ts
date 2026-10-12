import axios from 'axios'
import { isDevMode } from '../../uno/services/auth'

// SMO uses /smo/* path prefix on the ALB (not /api/v1/smo/*)
// This avoids the UNO /api/v1/* listener rule (priority 1) catching SMO requests
const smoClient = axios.create({
    baseURL: '/smo',
    headers: { 'Content-Type': 'application/json' },
    withCredentials: true,
})

smoClient.interceptors.request.use(
    (config) => {
        if (isDevMode()) {
            config.headers['X-Dev-Mode'] = 'true'
        }
        return config
    },
    (error) => Promise.reject(error)
)

// ── Job Types ──

export interface PathPair {
    sourcePath: string
    targetPath: string
}

export type JobStatus =
    | 'PENDING' | 'QUEUED' | 'RUNNING' | 'PROCESSING'
    | 'COMPLETED' | 'SUCCESS'
    | 'FAILED' | 'ERROR' | 'TIMED_OUT'
    | 'CANCELLED'

export interface SyncJob {
    jobId: string
    jobName: string
    status: JobStatus
    operatingSystem: 'Linux' | 'Windows' | 'Unix'
    sourceHost: string
    targetInstanceId: string
    sshKeyArn: string
    pathPairs: PathPair[]
    credentialType: 'secretsmanager' | 'parameterstore'
    credentialFormat?: 'username-password'
    transferEngine?: 'rsync' | 'rclone' | 'robocopy'
    bandwidthLimit?: string
    excludePatterns?: string
    preserveACL?: boolean
    preserveXattrs?: boolean
    tags?: string[]
    targetAccountId?: string
    targetAccountAlias?: string
    targetRegion?: string
    progress?: number
    filesTransferred?: number
    bytesTransferred?: number
    duration?: number
    currentStep?: string
    liveOutput?: string
    liveOutputStep?: string
    liveOutputUpdatedAt?: string
    ssmCommandId?: string
    errorMessage?: string
    errorSummary?: string
    errorCategory?: string
    retryCount?: number
    retriedFromJobId?: string
    lastDeltaCheckAt?: string
    lastDeltaCheckHasChanges?: boolean
    lastDeltaCheckNewFiles?: number
    lastDeltaCheckNewBytes?: number
    createdAt: string
    updatedAt?: string
    startedAt?: string
    completedAt?: string
}

export interface ScheduleAttachment {
    type: 'once' | 'recurring'
    date?: string
    time?: string
    startDate?: string
    startTime?: string
    days?: number
    timezone: string
}

export interface CreateJobParams {
    jobName: string
    operatingSystem: string
    sourceHost: string
    targetInstanceId: string
    sshKeyArn: string
    pathPairs: PathPair[]
    credentialType?: string
    credentialFormat?: string
    transferEngine?: string
    bandwidthLimit?: string
    excludePatterns?: string
    preserveACL?: boolean
    preserveXattrs?: boolean
    tags?: string[]
    targetAccountId?: string
    targetAccountAlias?: string
    targetRegion?: string
    schedule?: ScheduleAttachment
}

// ── Account Types ──

export interface Account {
    accountId: string
    alias: string
    externalId: string
    crossAccountRoleName?: string
    status: 'active' | 'inactive'
    roleStatus?: 'verified' | 'failed' | 'unverified'
    lastVerificationAttempt?: string
    maskedAccountId?: string
    registeredBy?: string
}

export interface RegisterAccountParams {
    targetAccountId: string
    alias: string
    externalId: string
    crossAccountRoleName?: string
    secretsManagerEndpointUrl?: string
}

// ── Schedule Types ──

export interface Schedule {
    scheduleId: string
    scheduleName: string
    cronExpression: string
    scheduleType: 'once' | 'recurring'
    timezone: string
    enabled: boolean
    jobTemplate: CreateJobParams
    runCount?: number
    lastRunAt?: string
    clonedFrom?: string
    createdAt: string
    updatedAt?: string
    endDate?: string
}

export interface CreateScheduleParams {
    scheduleName: string
    cronExpression: string
    scheduleType: 'once' | 'recurring'
    timezone: string
    enabled: boolean
    jobTemplate: CreateJobParams
    endDate?: string
}

// ── Auth/RBAC Types ──

export type SmoRole = 'SuperAdmin' | 'MigrationAdmin' | 'MigrationEngineer'

export interface AuthorizedAccount {
    accountId: string
    alias: string
    permissionLevel: 'OWNER' | 'CONTRIB' | 'ALIAS'
}

export interface SmoUserInfo {
    email?: string
    role: SmoRole
    groups?: string[]
    authorizedAccounts: '*' | AuthorizedAccount[]
    logoutUrl?: string | null
}

// ── Inventory Types ──

export interface InventoryServer {
    serverId: string
    serverName: string
    hostIp: string
    operatingSystem: string
    instanceId?: string
    targetInstanceId?: string
    accountId?: string
    sshKeyArn?: string
    credentialType?: string
    syncPaths?: string[]
    appName?: string
    transferEngine?: string
    targetAccountId?: string
}

export interface InventorySearchResult {
    sources: InventoryServer[]
    targets: InventoryServer[]
}

// ── Validation Types ──

export interface ValidationResult {
    validationId: string
    status: 'PENDING' | 'COMPLETED' | 'FAILED'
    ssmCommandId?: string
    instanceId?: string
    targetAccountId?: string
    results?: {
        connectivity_status: string
        space_check_status: string
        [key: string]: unknown
    }
    error?: string
}

// ── Instance Health Types ──

export interface InstanceHealth {
    status: 'healthy' | 'warning' | 'unhealthy'
    metrics: {
        cpuUtilization: number
        diskUtilization: number
        memoryUtilization?: number
        networkIn?: number
        networkOut?: number
    }
    reasons?: Array<{
        metric: string
        level: 'warning' | 'unhealthy'
    }>
}

// ── API Functions: Jobs ──

export const listSyncJobs = async (): Promise<{ jobs: SyncJob[] }> => {
    const response = await smoClient.get('/sync')
    return response.data
}

export const createSyncJob = async (params: CreateJobParams): Promise<SyncJob> => {
    const response = await smoClient.post('/sync', params)
    return response.data
}

export const getSyncStatus = async (jobId: string): Promise<SyncJob> => {
    const response = await smoClient.get(`/sync/${jobId}`)
    return response.data
}

export const updateSyncJob = async (
    jobId: string,
    updates: Partial<SyncJob>
): Promise<SyncJob> => {
    const response = await smoClient.patch(`/sync/${jobId}`, updates)
    return response.data
}

export const deleteSyncJob = async (jobId: string): Promise<void> => {
    await smoClient.delete(`/sync/${jobId}`)
}

export const retrySyncJob = async (jobId: string): Promise<SyncJob> => {
    const response = await smoClient.post(`/sync/${jobId}/retry`)
    return response.data
}

export const cancelSyncJob = async (jobId: string): Promise<SyncJob> => {
    const response = await smoClient.post(`/sync/${jobId}/cancel`)
    return response.data
}

// ── API Functions: Logs ──

export const getSyncLogs = async (jobId: string): Promise<{ logs: string[] }> => {
    const response = await smoClient.get(`/sync/${jobId}/logs`)
    return response.data
}

// ── API Functions: Delta Check ──

export const runDeltaCheck = async (
    jobId: string
): Promise<{ dryRunJobId: string; error?: string }> => {
    const response = await smoClient.post(`/sync/${jobId}/delta`)
    return response.data
}

// ── API Functions: Instance Health ──

export const getInstanceHealth = async (
    jobId: string,
    force?: boolean
): Promise<InstanceHealth> => {
    const url = force
        ? `/sync/${jobId}/health?force=true`
        : `/sync/${jobId}/health`
    const response = await smoClient.get(url)
    return response.data
}

// ── API Functions: Accounts ──

export const listAccounts = async (): Promise<{ accounts: Account[] }> => {
    const response = await smoClient.get('/accounts')
    return response.data
}

export const registerAccount = async (
    params: RegisterAccountParams
): Promise<{ trustPolicy?: string; roleWarning?: string }> => {
    const response = await smoClient.post('/configure-cross-account', params)
    return response.data
}

export const deactivateAccount = async (accountId: string): Promise<void> => {
    await smoClient.post('/configure-cross-account', {
        targetAccountId: accountId,
        action: 'deactivate',
    })
}

export const reactivateAccount = async (accountId: string): Promise<void> => {
    await smoClient.post('/configure-cross-account', {
        targetAccountId: accountId,
        action: 'reactivate',
    })
}

export const deleteAccount = async (accountId: string): Promise<void> => {
    await smoClient.post('/configure-cross-account', {
        targetAccountId: accountId,
        action: 'delete',
    })
}

export const verifyAccountRole = async (accountId: string): Promise<void> => {
    await smoClient.post('/configure-cross-account', {
        targetAccountId: accountId,
        action: 'verify-role',
    })
}

// ── API Functions: Schedules ──

export const listSchedules = async (): Promise<{ schedules: Schedule[] }> => {
    const response = await smoClient.get('/schedules')
    return response.data
}

export const getSchedule = async (scheduleId: string): Promise<Schedule> => {
    const response = await smoClient.get(`/schedules/${scheduleId}`)
    return response.data
}

export const createSchedule = async (
    params: CreateScheduleParams
): Promise<Schedule> => {
    const response = await smoClient.post('/schedules', params)
    return response.data
}

export const updateSchedule = async (
    scheduleId: string,
    updates: Partial<CreateScheduleParams>
): Promise<Schedule> => {
    const response = await smoClient.patch(`/schedules/${scheduleId}`, updates)
    return response.data
}

export const deleteSchedule = async (scheduleId: string): Promise<void> => {
    await smoClient.delete(`/schedules/${scheduleId}`)
}

// ── API Functions: Inventory ──

export const searchInventory = async (
    motsId: string
): Promise<InventorySearchResult> => {
    const response = await smoClient.get(
        `/inventory/${encodeURIComponent(motsId)}`
    )
    return response.data
}

// ── API Functions: Validation ──

export const runValidation = async (
    params: Record<string, unknown>
): Promise<ValidationResult> => {
    const response = await smoClient.post('/validate', params)
    return response.data
}

export const getValidationResults = async (
    validationId: string,
    params?: Record<string, string>
): Promise<ValidationResult> => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    const response = await smoClient.get(`/validate/${validationId}${qs}`)
    return response.data
}

// ── API Functions: Auth ──

export const getCurrentUser = async (): Promise<SmoUserInfo> => {
    const response = await smoClient.get('/auth/me')
    return response.data
}

// ── API Functions: Health ──

export const getHealth = async (): Promise<{ status: string; timestamp: string }> => {
    const response = await smoClient.get('/health')
    return response.data
}

// Re-export smoClient for direct use in hooks
export { smoClient }
