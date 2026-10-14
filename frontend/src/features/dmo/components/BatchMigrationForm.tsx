import { useState, useEffect } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Box from '@cloudscape-design/components/box'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Alert from '@cloudscape-design/components/alert'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ExpandableSection from '@cloudscape-design/components/expandable-section'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import { useMigrationStore } from '../store/migrationStore'
import { startBatchMigration, getBatchMigrationStatus, retryMigration, refreshStats } from '../services/api'

interface Database {
  id: string
  source: string
  target: string
}

interface DatabaseProgress {
  database: string
  status: string
  progress: number
  currentStep: string
  logs: Array<{ message: string; type: string }>
  expandedLogs: boolean
  tableCount?: number
  rowCount?: number
  viewCount?: number
  functionCount?: number
  indexCount?: number
  dbSize?: number
  migrationId?: string
}

export function BatchMigrationForm() {
  const {
    sourceInstanceId,
    targetInstanceId,
    sourcePassword,
    targetPassword,
    sourceWindowsPassword,
    targetWindowsPassword,
    sourcePasswordMethod,
    targetPasswordMethod,
    sourceSecretArn,
    targetSecretArn,
    options,
    target,
  } = useMigrationStore()

  const [databases, setDatabases] = useState<Database[]>([{ id: '1', source: '', target: '' }])
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [batchId, setBatchId] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<DatabaseProgress[]>([])
  const [overallProgress, setOverallProgress] = useState(0)
  const [completedCount, setCompletedCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [refreshingStats, setRefreshingStats] = useState<string | null>(null)

  useEffect(() => {
    const savedState = localStorage.getItem('batchMigrationState')
    if (savedState) {
      try {
        const state = JSON.parse(savedState)
        const stateAge = Date.now() - (state.timestamp || 0)
        if (stateAge < 2 * 60 * 60 * 1000 && state.isRunning && state.batchId) {
          setDatabases(state.databases || [{ id: '1', source: '', target: '' }])
          setIsRunning(true)
          setBatchId(state.batchId)
          setStartTime(state.startTime || null)
          setBatchProgress(state.batchProgress || [])
          setOverallProgress(state.overallProgress || 0)
          setCompletedCount(state.completedCount || 0)
          setFailedCount(state.failedCount || 0)
          pollBatchStatus(state.batchId)
        } else {
          localStorage.removeItem('batchMigrationState')
        }
      } catch {
        localStorage.removeItem('batchMigrationState')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (isRunning && batchId) {
      localStorage.setItem(
        'batchMigrationState',
        JSON.stringify({
          databases,
          isRunning,
          isComplete,
          batchId,
          startTime,
          batchProgress,
          overallProgress,
          completedCount,
          failedCount,
          timestamp: Date.now(),
        })
      )
    } else if (isComplete) {
      localStorage.removeItem('batchMigrationState')
    }
  }, [
    isRunning,
    isComplete,
    batchId,
    startTime,
    databases,
    batchProgress,
    overallProgress,
    completedCount,
    failedCount,
  ])

  const addDatabase = () => {
    if (databases.length >= 4) {
      alert('Maximum 4 databases can be migrated at once')
      return
    }
    setDatabases([...databases, { id: Date.now().toString(), source: '', target: '' }])
  }

  const removeDatabase = (id: string) => {
    if (databases.length === 1) {
      alert('At least one database is required')
      return
    }
    setDatabases(databases.filter((db) => db.id !== id))
  }

  const updateDatabase = (id: string, field: 'source' | 'target', value: string) => {
    setDatabases(databases.map((db) => (db.id === id ? { ...db, [field]: value } : db)))
  }

  const toggleLogs = (database: string) => {
    setBatchProgress((prev) =>
      prev.map((db) =>
        db.database === database ? { ...db, expandedLogs: !db.expandedLogs } : db
      )
    )
  }

  const handleRefreshStats = async (migrationId: string, database: string) => {
    setRefreshingStats(database)
    try {
      const stats = await refreshStats(migrationId)
      setBatchProgress((prev) =>
        prev.map((db) => (db.database === database ? { ...db, ...stats } : db))
      )
    } catch (e) {
      console.error('Failed to refresh stats:', e)
    }
    setRefreshingStats(null)
  }

  const resetMigration = () => {
    setIsRunning(false)
    setIsComplete(false)
    setBatchId(null)
    setBatchProgress([])
    setOverallProgress(0)
    setCompletedCount(0)
    setFailedCount(0)
  }

  const handleRetryMigration = async (database: string, migrationId: string) => {
    if (!migrationId) {
      alert('Cannot retry: Migration ID not found')
      return
    }
    if (!confirm(`Retry migration for ${database}?\n\nThis will start a new migration with the same parameters.`))
      return
    try {
      setBatchProgress((prev) =>
        prev.map((db) =>
          db.database === database
            ? {
                ...db,
                status: 'PENDING',
                progress: 0,
                currentStep: 'Retrying migration...',
                logs: [
                  ...db.logs,
                  {
                    message: `[${new Date().toLocaleTimeString()}] Retrying migration...`,
                    type: 'info',
                  },
                ],
              }
            : db
        )
      )
      const response = await retryMigration(migrationId)
      setBatchProgress((prev) =>
        prev.map((db) =>
          db.database === database
            ? {
                ...db,
                migrationId: response.migrationId,
                status: 'INITIALIZING',
                progress: 5,
                currentStep: 'Initializing retry...',
                logs: [
                  ...db.logs,
                  {
                    message: `[${new Date().toLocaleTimeString()}] Retry started — New Migration ID: ${response.migrationId}`,
                    type: 'success',
                  },
                ],
              }
            : db
        )
      )
      setFailedCount((prev) => Math.max(0, prev - 1))
      if (!isRunning && batchId) {
        setIsRunning(true)
        setIsComplete(false)
        pollBatchStatus(batchId)
      }
    } catch (error: any) {
      alert(`Failed to retry migration:\n\n${error.message}`)
      setBatchProgress((prev) =>
        prev.map((db) =>
          db.database === database
            ? {
                ...db,
                status: 'FAILED',
                logs: [
                  ...db.logs,
                  {
                    message: `[${new Date().toLocaleTimeString()}] Retry failed: ${error.message}`,
                    type: 'error',
                  },
                ],
              }
            : db
        )
      )
    }
  }

  const startMigration = async () => {
    const emptyDatabases = databases.filter((db) => !db.source || !db.target)
    if (emptyDatabases.length > 0) {
      alert('Please fill in all database names')
      return
    }
    if (!sourceInstanceId || !targetInstanceId) {
      alert(
        'Configuration Required\n\nPlease configure EC2 instances first:\n\n1. Switch to "Single Database" tab\n2. Complete Steps 1-3\n3. Return to "Batch Migration" tab'
      )
      return
    }
    if (sourcePasswordMethod === 'direct' && !sourcePassword) { // pragma: allowlist secret
      alert('Source password is required.')
      return
    }
    if (targetPasswordMethod === 'direct' && !targetPassword) { // pragma: allowlist secret
      alert('Target password is required.')
      return
    }
    if (sourcePasswordMethod === 'secretsManager' && !sourceSecretArn) { // pragma: allowlist secret
      alert('Source Secrets Manager ARN is required.')
      return
    }
    if (targetPasswordMethod === 'secretsManager' && !targetSecretArn) { // pragma: allowlist secret
      alert('Target Secrets Manager ARN is required.')
      return
    }
    if (!sourceWindowsPassword || !targetWindowsPassword) {
      alert(
        'Please configure Windows/Admin passwords in the Single Database form first.'
      )
      return
    }

    const databaseList = databases.map((db) => `  • ${db.source} → ${db.target}`).join('\n')
    if (
      !confirm(
        `Are you sure you want to start batch migration?\n\nThis will migrate ${databases.length} database(s):\n${databaseList}\n\nThis operation cannot be undone.`
      )
    )
      return

    setIsRunning(true)
    try {
      const payload = {
        databases: databases.map((db) => ({ source: db.source, target: db.target })),
        sourceInstanceId,
        targetInstanceId,
        sourcePassword: sourcePasswordMethod === 'direct' ? sourcePassword : '', // pragma: allowlist secret
        targetPassword: targetPasswordMethod === 'direct' ? targetPassword : '', // pragma: allowlist secret
        sourceSecretArn: sourcePasswordMethod === 'secretsManager' ? sourceSecretArn : '', // pragma: allowlist secret
        targetSecretArn: targetPasswordMethod === 'secretsManager' ? targetSecretArn : '', // pragma: allowlist secret
        sourcePasswordMethod,
        targetPasswordMethod,
        sourceWindowsPassword,
        targetWindowsPassword,
        options: {
          ...(options || {}),
          migrationType: options?.migrationType || 'logical',
          sourceUsername: 'migrationuser',
          targetUsername: 'migrationuser',
        },
        ...(target.backupStorageMethod
          ? {
              backupStorage: {
                method: target.backupStorageMethod,
                networkSharePath: target.networkSharePath,
                shareUsername: target.shareUsername,
                sharePassword: target.sharePassword,
                s3Bucket: target.s3Bucket,
                region: target.region,
                fsxId: target.fsxId,
                fsxPath: target.fsxPath,
              },
            }
          : {}),
      }
      const response = await startBatchMigration(payload)
      setBatchId(response.batchId)
      setStartTime(new Date().toLocaleString())
      setBatchProgress(
        databases.map((db) => ({
          database: db.source,
          status: 'PENDING',
          progress: 0,
          currentStep: 'Initializing...',
          logs: [
            {
              message: `[${new Date().toLocaleTimeString()}] Bulk Migration Started`,
              type: 'info',
            },
            {
              message: `[${new Date().toLocaleTimeString()}] Batch ID: ${response.batchId}`,
              type: 'info',
            },
            {
              message: `[${new Date().toLocaleTimeString()}] Source: ${db.source} → Target: ${db.target}`,
              type: 'info',
            },
          ],
          expandedLogs: false,
        }))
      )
      pollBatchStatus(response.batchId)
    } catch (error: any) {
      alert(`Failed to start batch migration:\n\n${error.message}`)
      setIsRunning(false)
    }
  }

  const pollBatchStatus = async (id: string) => {
    let pollCount = 0
    const maxPolls = 1200
    const stuckThreshold = 300
    const lastProgressSnapshot: { [key: string]: number } = {}
    const unchangedCount: { [key: string]: number } = {}

    const pollInterval = setInterval(async () => {
      pollCount++
      if (pollCount > maxPolls) {
        clearInterval(pollInterval)
        setIsRunning(false)
        setBatchProgress((prev) =>
          prev.map((db) => {
            if (db.status === 'IN_PROGRESS' || db.status === 'PENDING') {
              return {
                ...db,
                status: 'FAILED',
                currentStep: 'Migration timeout',
                logs: [
                  ...db.logs,
                  {
                    message: `[${new Date().toLocaleTimeString()}] Migration timeout after 60 minutes.`,
                    type: 'error',
                  },
                ],
              }
            }
            return db
          })
        )
        return
      }
      try {
        const status = await getBatchMigrationStatus(id)
        setBatchProgress((prevProgress) => {
          const updatedProgress = status.migrations.map((migration: any) => {
            const existing = prevProgress.find((p) => p.database === migration.database)
            const dbKey = migration.database
            if (migration.status === 'IN_PROGRESS') {
              if (!lastProgressSnapshot[dbKey]) {
                lastProgressSnapshot[dbKey] = migration.progress || 0
                unchangedCount[dbKey] = 0
              } else if (lastProgressSnapshot[dbKey] === migration.progress) {
                unchangedCount[dbKey] = (unchangedCount[dbKey] || 0) + 1
                if (unchangedCount[dbKey] >= stuckThreshold) {
                  migration.status = 'FAILED'
                  migration.error = `Migration appears stuck at ${migration.progress}%.`
                }
              } else {
                lastProgressSnapshot[dbKey] = migration.progress || 0
                unchangedCount[dbKey] = 0
              }
            } else {
              unchangedCount[dbKey] = 0
            }

            let displayMessage = migration.currentStep || 'Processing...'
            if (migration.status === 'FAILED' && migration.error) {
              displayMessage = `Failed: ${migration.error.substring(0, 100)}`
            }

            const existingLogs = existing?.logs || []
            const timestampedLog = `[${new Date().toLocaleTimeString()}] ${displayMessage}`
            const lastLogMessage = existingLogs[existingLogs.length - 1]?.message.split('] ')[1] || ''
            let logType = 'info'
            if (displayMessage.includes('success')) logType = 'success'
            else if (displayMessage.includes('failed')) logType = 'error'

            const updatedLogs =
              lastLogMessage === displayMessage
                ? existingLogs
                : [...existingLogs, { message: timestampedLog, type: logType }].slice(-10)
            let finalLogs = updatedLogs
            if (migration.status === 'COMPLETED' && migration.tableCount !== undefined) {
              const hasTableCountLog = finalLogs.some((log: any) =>
                log.message.includes('Tables migrated:')
              )
              if (!hasTableCountLog) {
                finalLogs = [
                  ...finalLogs,
                  {
                    message: `[${new Date().toLocaleTimeString()}] Migration completed successfully.`,
                    type: 'success',
                  },
                  {
                    message: `[${new Date().toLocaleTimeString()}] Tables migrated: ${migration.tableCount}`,
                    type: 'success',
                  },
                  {
                    message: `[${new Date().toLocaleTimeString()}] Total rows: ${migration.rowCount || 0}`,
                    type: 'success',
                  },
                ]
              }
            }

            return {
              database: migration.database,
              migrationId: migration.migrationId,
              status: migration.status,
              progress: Number(migration.progress) || 0,
              currentStep: displayMessage,
              logs: finalLogs,
              expandedLogs: existing?.expandedLogs || false,
              tableCount: migration.tableCount,
              rowCount: migration.rowCount,
              viewCount: migration.viewCount,
              functionCount: migration.functionCount,
              indexCount: migration.indexCount,
              dbSize: migration.dbSize,
            }
          })

          const totalProgress = updatedProgress.reduce(
            (sum: number, db: any) => sum + db.progress,
            0
          )
          setOverallProgress(
            updatedProgress.length > 0 ? Math.round(totalProgress / updatedProgress.length) : 0
          )
          const completed = updatedProgress.filter((db: any) => db.status === 'COMPLETED').length
          const failed = updatedProgress.filter((db: any) => db.status === 'FAILED').length
          setCompletedCount(completed)
          setFailedCount(failed)
          if (completed + failed === databases.length) {
            clearInterval(pollInterval)
            setIsRunning(false)
            setIsComplete(true)
          }
          return updatedProgress
        })
      } catch (error) {
        console.error('Error polling batch status:', error)
      }
    }, 3000)
  }

  const getStatusType = (
    status: string
  ):
    | 'success'
    | 'error'
    | 'in-progress'
    | 'warning'
    | 'info'
    | 'stopped'
    | 'pending'
    | 'loading' => {
    if (status === 'COMPLETED') return 'success'
    if (status === 'FAILED') return 'error'
    if (status === 'PENDING') return 'pending'
    return 'in-progress'
  }

  const formatSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '-'
    if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
    if (bytes > 1048576) return (bytes / 1048576).toFixed(0) + ' MB'
    return (bytes / 1024).toFixed(0) + ' KB'
  }

  const dbTypeLabel =
    (
      {
        mysql: 'MySQL',
        postgresql: 'PostgreSQL',
        sqlserver: 'SQL Server',
        mongodb: 'MongoDB',
        mariadb: 'MariaDB',
      } as Record<string, string>
    )[options?.databaseType || 'mysql'] || options?.databaseType

  if (!isRunning && !isComplete) {
    return (
      <SpaceBetween size="l">
        <Container
          header={
            <Header
              variant="h2"
              description="Migrate up to 4 databases simultaneously for faster total migration time"
            >
              Bulk Database Migration
            </Header>
          }
        >
          <SpaceBetween size="m">
            {databases.map((db, index) => (
              <SpaceBetween key={db.id} direction="horizontal" size="m" alignItems="end">
                <Box variant="h4" padding={{ top: 's' }}>
                  {index + 1}.
                </Box>
                <FormField label="Source Database">
                  <Input
                    value={db.source}
                    onChange={({ detail }) => updateDatabase(db.id, 'source', detail.value)}
                    placeholder="e.g., ProductionDB"
                  />
                </FormField>
                <Box variant="p" padding={{ top: 'l' }}>
                  →
                </Box>
                <FormField label="Target Database">
                  <Input
                    value={db.target}
                    onChange={({ detail }) => updateDatabase(db.id, 'target', detail.value)}
                    placeholder="e.g., ProductionDB_New"
                  />
                </FormField>
                {databases.length > 1 && (
                  <Button
                    iconName="close"
                    variant="icon"
                    onClick={() => removeDatabase(db.id)}
                    ariaLabel="Remove database"
                  />
                )}
              </SpaceBetween>
            ))}
            {databases.length < 4 && (
              <Button iconName="add-plus" onClick={addDatabase}>
                Add Database ({databases.length}/4)
              </Button>
            )}
          </SpaceBetween>
        </Container>

        <Button variant="primary" onClick={startMigration} iconName="caret-right-filled">
          Start Bulk Migration
        </Button>

        <Alert type="warning" header="Important">
          Before using batch migration:
          <ol style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.5rem' }}>
            <li>Configure EC2 instances and credentials in the "Single Database" tab (Steps 1-3)</li>
            <li>The batch migration will use those settings for all databases</li>
          </ol>
        </Alert>
      </SpaceBetween>
    )
  }

  return (
    <SpaceBetween size="l">
      {batchId && (
        <Container header={<Header variant="h2">Bulk Migration Information</Header>}>
          <KeyValuePairs
            columns={3}
            items={[
              { label: 'Batch ID', value: batchId },
              { label: 'Migration Type', value: options?.migrationType || 'logical' },
              { label: 'DB Type', value: dbTypeLabel },
              { label: 'Databases', value: String(databases.length) },
              { label: 'Started', value: startTime || new Date().toLocaleString() },
            ]}
          />
        </Container>
      )}

      <Container header={<Header variant="h2">Bulk Migration Progress</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={4}>
            <Box textAlign="center">
              <Box variant="h1" color="text-status-info">
                {overallProgress}%
              </Box>
              <Box variant="small">Overall Progress</Box>
            </Box>
            <Box textAlign="center">
              <Box variant="h1" color="text-status-success">
                {completedCount}
              </Box>
              <Box variant="small">Completed</Box>
            </Box>
            <Box textAlign="center">
              <Box variant="h1" color="text-status-error">
                {failedCount}
              </Box>
              <Box variant="small">Failed</Box>
            </Box>
            <Box textAlign="center">
              <Box variant="h1">{databases.length - completedCount - failedCount}</Box>
              <Box variant="small">In Progress</Box>
            </Box>
          </ColumnLayout>
          <ProgressBar value={overallProgress} label="Overall Progress" />
        </SpaceBetween>
      </Container>

      {batchProgress.map((db) => {
        const dbMapping = databases.find((d) => d.source === db.database)
        const displayTitle = dbMapping ? `${dbMapping.source} → ${dbMapping.target}` : db.database
        return (
          <Container
            key={db.database}
            header={
              <Header
                variant="h3"
                actions={
                  <SpaceBetween direction="horizontal" size="xs">
                    {db.status === 'FAILED' && db.migrationId && (
                      <Button
                        onClick={() => handleRetryMigration(db.database, db.migrationId!)}
                        iconName="refresh"
                      >
                        Retry
                      </Button>
                    )}
                    {db.status === 'COMPLETED' && db.migrationId && (
                      <Button
                        onClick={() => handleRefreshStats(db.migrationId!, db.database)}
                        loading={refreshingStats === db.database}
                        iconName="refresh"
                      >
                        Refresh Stats
                      </Button>
                    )}
                  </SpaceBetween>
                }
              >
                <SpaceBetween direction="horizontal" size="xs">
                  <span>{displayTitle}</span>
                  <StatusIndicator type={getStatusType(db.status)}>{db.status}</StatusIndicator>
                </SpaceBetween>
              </Header>
            }
          >
            <SpaceBetween size="m">
              <ProgressBar
                value={db.progress}
                status={
                  db.status === 'COMPLETED'
                    ? 'success'
                    : db.status === 'FAILED'
                    ? 'error'
                    : 'in-progress'
                }
                description={db.currentStep}
              />
              {db.status === 'COMPLETED' && db.tableCount !== undefined && (
                <KeyValuePairs
                  columns={3}
                  items={[
                    { label: 'Tables', value: String(db.tableCount) },
                    { label: 'Rows', value: db.rowCount?.toLocaleString() || '0' },
                    ...(db.viewCount && db.viewCount > 0
                      ? [{ label: 'Views', value: String(db.viewCount) }]
                      : []),
                    ...(db.functionCount && db.functionCount > 0
                      ? [{ label: 'Functions', value: String(db.functionCount) }]
                      : []),
                    ...(db.indexCount && db.indexCount > 0
                      ? [{ label: 'Indexes', value: String(db.indexCount) }]
                      : []),
                    ...(db.dbSize && db.dbSize > 0
                      ? [{ label: 'DB Size', value: formatSize(db.dbSize) }]
                      : []),
                  ]}
                />
              )}
              <ExpandableSection
                headerText={db.expandedLogs ? 'Hide Logs' : 'Show Logs'}
                expanded={db.expandedLogs}
                onChange={() => toggleLogs(db.database)}
              >
                <Box variant="code">
                  {db.logs.map((log, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '2px 0',
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color:
                          log.type === 'error'
                            ? '#d13212'
                            : log.type === 'success'
                            ? '#037f0c'
                            : undefined,
                      }}
                    >
                      {log.message}
                    </div>
                  ))}
                </Box>
              </ExpandableSection>
            </SpaceBetween>
          </Container>
        )
      })}

      {isComplete && (
        <Button variant="primary" onClick={resetMigration} iconName="caret-right-filled">
          Start New Bulk Migration
        </Button>
      )}
    </SpaceBetween>
  )
}
