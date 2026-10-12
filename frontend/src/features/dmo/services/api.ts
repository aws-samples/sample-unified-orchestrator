import axios from 'axios'

const dmoClient = axios.create({
  baseURL: import.meta.env.VITE_DMO_API_URL || '/db-migration',
  headers: { 'Content-Type': 'application/json' },
})

export const DMO_POLL_INTERVAL = 2000

// ── Types ──

export interface MigrationRequest {
  source: {
    host: string
    database: string
    username: string
  }
  target: {
    host: string
    database: string
    username: string
  }
  sourceInstanceId: string
  targetInstanceId: string
  s3Bucket: string
  sourcePassword: string
  targetPassword: string
  sourceWindowsPassword: string
  targetWindowsPassword: string
  options?: any
  backupStorage?: {
    method: string
    networkSharePath?: string
    shareUsername?: string
    sharePassword?: string
    s3Bucket?: string
    region?: string
    fsxId?: string
    fsxPath?: string
  }
}

export interface MigrationResponse {
  migrationId: string
  executionArn: string
  message: string
}

export interface MigrationStatus {
  migrationId: string
  status: 'INITIALIZING' | 'BACKING_UP' | 'UPLOAD_COMPLETE' | 'RESTORING' | 'COMPLETED' | 'FAILED'
  progress: number
  currentStep: string
  startTime: string
  endTime?: string
  logs: string[]
  error?: string
  tableCount?: number
  rowCount?: number
}

export interface BatchMigrationRequest {
  databases: Array<{ source: string; target: string }>
  sourceInstanceId: string
  targetInstanceId: string
  sourcePassword: string
  targetPassword: string
  sourceWindowsPassword: string
  targetWindowsPassword: string
  options?: any
}

export interface BatchMigrationResponse {
  batchId: string
  migrationIds: string[]
  message: string
}

export interface BatchMigrationStatus {
  batchId: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  totalDatabases: number
  completedDatabases: number
  failedDatabases: number
  migrations: Array<{
    migrationId: string
    database: string
    status: string
    progress: number
    currentStep: string
  }>
}

export interface TestConnectionParams {
  instanceId: string
  databaseType: string
  host: string
  port: number
  database: string
  username: string
  password: string
}

export interface TestConnectionResult {
  success: boolean
  message?: string
  error?: string
}

// ── API Functions ──

export async function startMigration(request: MigrationRequest): Promise<MigrationResponse> {
  const { data } = await dmoClient.post('/migrate', request)
  return data
}

export async function getMigrationStatus(migrationId: string): Promise<MigrationStatus> {
  const { data } = await dmoClient.get(`/status/${migrationId}`)
  return data
}

export async function startBatchMigration(
  request: BatchMigrationRequest
): Promise<BatchMigrationResponse> {
  const { data } = await dmoClient.post('/batch-migration/start', request)
  return data
}

export async function getBatchMigrationStatus(batchId: string): Promise<BatchMigrationStatus> {
  const { data } = await dmoClient.get(`/batch-migration/${batchId}`)
  return data
}

export async function retryMigration(migrationId: string): Promise<MigrationResponse> {
  const { data } = await dmoClient.post(`/retry/${migrationId}`)
  return {
    migrationId: data.newMigrationId,
    executionArn: data.executionArn,
    message: data.message,
  }
}

export async function listMigrations(): Promise<{ migrations: any[]; total: number }> {
  const { data } = await dmoClient.get('/migrations')
  return data
}

export async function stopReplication(migrationId: string): Promise<{ message: string }> {
  const { data } = await dmoClient.post(`/stop-replication/${migrationId}`)
  return data
}

export async function refreshStats(migrationId: string): Promise<Record<string, any>> {
  const { data } = await dmoClient.post(`/refresh-stats/${migrationId}`)
  return data
}

export async function testConnection(params: TestConnectionParams): Promise<TestConnectionResult> {
  const { data } = await dmoClient.post('/test-connection', params)
  return data
}

/**
 * Poll migration status with automatic updates.
 * Returns a cleanup function to stop polling.
 */
export function pollMigrationStatus(
  migrationId: string,
  onUpdate: (status: MigrationStatus) => void,
  onError?: (error: Error) => void,
  interval: number = DMO_POLL_INTERVAL
): () => void {
  let isActive = true

  const poll = async () => {
    while (isActive) {
      try {
        const status = await getMigrationStatus(migrationId)
        onUpdate(status)
        if (status.status === 'COMPLETED' || status.status === 'FAILED') {
          isActive = false
          break
        }
      } catch (error) {
        if (onError) onError(error as Error)
      }
      if (isActive) {
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }
  }

  poll()

  return () => {
    isActive = false
  }
}

export { dmoClient }
