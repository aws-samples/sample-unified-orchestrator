import { useState } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Box from '@cloudscape-design/components/box'
import Alert from '@cloudscape-design/components/alert'
import ProgressBar from '@cloudscape-design/components/progress-bar'
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs'
import { useMigrationStore } from '../store/migrationStore'
import { startMigration, pollMigrationStatus, type MigrationStatus } from '../services/api'

interface ReviewAndExecuteProps {
  onPrev: () => void
}

export const ReviewAndExecute = ({ onPrev }: ReviewAndExecuteProps) => {
  const {
    source,
    target,
    options,
    sourceInstanceId,
    targetInstanceId,
    sourcePassword,
    targetPassword,
    sourceWindowsPassword,
    targetWindowsPassword,
  } = useMigrationStore()

  const [isRunning, setIsRunning] = useState(false)
  const [migrationId, setMigrationId] = useState('')
  const [status, setStatus] = useState<MigrationStatus | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState('')

  const startMigrationProcess = async () => {
    if (!confirm('Are you sure you want to start the migration? This operation cannot be undone.'))
      return
    if (!sourceInstanceId || !targetInstanceId) {
      setError('Source and Target EC2 Instance IDs are required')
      return
    }
    if (!sourcePassword || !targetPassword) {
      setError('Source and Target database passwords are required')
      return
    }
    if (!sourceWindowsPassword || !targetWindowsPassword) {
      setError('Source and Target Windows Administrator passwords are required')
      return
    }

    setIsRunning(true)
    setError('')
    setLogs([`[${new Date().toLocaleTimeString()}] Starting DMO migration...`])

    try {
      const response = await startMigration({
        source: {
          host: source.host,
          database: source.database,
          username: source.username || 'sa',
        },
        target: {
          host: target.endpoint,
          database: target.database,
          username: target.username || 'sa',
        },
        sourceInstanceId,
        targetInstanceId,
        s3Bucket: '',
        sourcePassword,
        targetPassword,
        sourceWindowsPassword,
        targetWindowsPassword,
        options,
        backupStorage: target.backupStorageMethod
          ? {
              method: target.backupStorageMethod,
              networkSharePath: target.networkSharePath,
              shareUsername: target.shareUsername,
              sharePassword: target.sharePassword,
              s3Bucket: target.s3Bucket,
              region: target.region,
              fsxId: target.fsxId,
              fsxPath: target.fsxPath,
            }
          : undefined,
      })

      setMigrationId(response.migrationId)
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] ${response.message}`,
        `[${new Date().toLocaleTimeString()}] Migration ID: ${response.migrationId}`,
        `[${new Date().toLocaleTimeString()}] Initializing migration...`,
      ])

      await new Promise((resolve) => setTimeout(resolve, 3000))

      pollMigrationStatus(
        response.migrationId,
        (newStatus) => {
          setStatus(newStatus)
          if (newStatus.currentStep) {
            setLogs((prev) => {
              const newLog = `[${new Date().toLocaleTimeString()}] ${newStatus.currentStep}`
              if (prev.length === 0 || !prev[prev.length - 1].includes(newStatus.currentStep))
                return [...prev, newLog]
              return prev
            })
          }
          if (newStatus.logs?.length) {
            const newLogs = newStatus.logs.map(
              (log) => `[${new Date().toLocaleTimeString()}] ${log}`
            )
            setLogs((prev) => Array.from(new Set([...prev, ...newLogs])))
          }
          if (newStatus.status === 'COMPLETED') {
            setLogs((prev) => {
              const updated = [
                ...prev,
                `[${new Date().toLocaleTimeString()}] Migration completed successfully.`,
              ]
              if (newStatus.tableCount)
                updated.push(
                  `[${new Date().toLocaleTimeString()}] Tables migrated: ${newStatus.tableCount}`
                )
              if (newStatus.rowCount)
                updated.push(
                  `[${new Date().toLocaleTimeString()}] Total rows: ${newStatus.rowCount}`
                )
              return updated
            })
            setIsRunning(false)
          } else if (newStatus.status === 'FAILED') {
            setError(newStatus.error || 'Migration failed')
            setLogs((prev) => [
              ...prev,
              `[${new Date().toLocaleTimeString()}] Migration failed: ${newStatus.error}`,
            ])
            setIsRunning(false)
          }
        },
        (err) => {
          setError(err.message)
          setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${err.message}`])
        }
      )
    } catch (err: any) {
      setError(err.message || 'Failed to start migration')
      setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Error: ${err.message}`])
      setIsRunning(false)
    }
  }

  const migrationTypeLabel =
    options.migrationType === 'physical'
      ? 'Physical Migration'
      : options.migrationType === 'logical'
      ? 'Logical Migration'
      : 'Replication'
  const backupStorageLabel =
    target.backupStorageMethod === 's3'
      ? 'Amazon S3'
      : target.backupStorageMethod === 'fsx'
      ? 'Amazon FSx'
      : target.backupStorageMethod === 'network-share'
      ? 'Network Share'
      : target.backupStorageMethod === 'direct'
      ? 'Direct Copy (No S3)'
      : 'Not configured'

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Migration Summary</Header>}>
        <SpaceBetween size="l">
          <KeyValuePairs
            columns={2}
            items={[
              {
                label: 'Source Database Type',
                value: `${source.type?.toUpperCase() || '-'} ${source.version || ''}`,
              },
              { label: 'Source Host', value: `${source.host || '-'}:${source.port || '-'}` },
              { label: 'Source Database', value: source.database || '-' },
              { label: 'Source Authentication', value: source.authType || '-' },
              { label: 'Target Service Type', value: target.serviceType?.toUpperCase() || '-' },
              { label: 'Target Engine', value: target.engine?.toUpperCase() || '-' },
              {
                label: 'Target Endpoint',
                value: `${target.endpoint || '-'}:${target.port || '-'}`,
              },
              { label: 'Target Database', value: target.database || '-' },
              { label: 'Target Authentication', value: target.authMethod || '-' },
              { label: 'AWS Region', value: target.region || 'N/A' },
              { label: 'Source EC2 Instance', value: sourceInstanceId || 'Not configured' },
              { label: 'Target EC2 Instance', value: targetInstanceId || 'Not configured' },
              { label: 'Backup Storage', value: backupStorageLabel },
              { label: 'Migration Type', value: migrationTypeLabel },
              {
                label: 'Verification',
                value: options.advanced.verifyData ? 'Enabled' : 'Disabled',
              },
              {
                label: 'Dry Run',
                value: options.advanced.dryRun ? 'Yes (Simulation Only)' : 'No (Live Migration)',
              },
            ]}
          />
          {options.migrationType === 'logical' && (
            <KeyValuePairs
              columns={2}
              items={[
                { label: 'Batch Size', value: `${options.logical.batchSize} rows` },
                { label: 'Parallel Threads', value: String(options.logical.parallelThreads) },
              ]}
            />
          )}
          {options.migrationType === 'replication' && (
            <KeyValuePairs
              columns={2}
              items={[
                {
                  label: 'Replication Type',
                  value:
                    options.replication.type === 'transactional'
                      ? 'Transactional'
                      : options.replication.type === 'snapshot'
                      ? 'Snapshot'
                      : 'Merge',
                },
                { label: 'Sync Interval', value: `${options.replication.syncInterval} seconds` },
                { label: 'Conflict Resolution', value: options.replication.conflictResolution },
              ]}
            />
          )}
          {target.s3Bucket && (
            <KeyValuePairs columns={2} items={[{ label: 'S3 Bucket', value: target.s3Bucket }]} />
          )}
          {target.fsxId && (
            <KeyValuePairs
              columns={2}
              items={[{ label: 'FSx File System', value: target.fsxId }]}
            />
          )}
          {target.networkSharePath && (
            <KeyValuePairs
              columns={2}
              items={[{ label: 'Network Share', value: target.networkSharePath }]}
            />
          )}
        </SpaceBetween>
      </Container>

      <Alert type="warning" header="Important">
        Please review all settings carefully before starting the migration. This operation may take
        significant time depending on database size.
        {(!sourceInstanceId || !targetInstanceId) && (
          <Box color="text-status-error" margin={{ top: 's' }}>
            Missing EC2 Instance IDs. Please go back and configure them.
          </Box>
        )}
      </Alert>

      {error && (
        <Alert type="error" header="Error">
          {error}
        </Alert>
      )}

      <SpaceBetween direction="horizontal" size="xs">
        <Button onClick={onPrev} disabled={isRunning}>
          Previous
        </Button>
        <Button
          variant="primary"
          onClick={startMigrationProcess}
          disabled={isRunning || !sourceInstanceId || !targetInstanceId}
          loading={isRunning}
        >
          {isRunning ? 'Migration Running...' : 'Start Migration'}
        </Button>
      </SpaceBetween>

      {status && (
        <Container header={<Header variant="h2">Migration Progress</Header>}>
          <SpaceBetween size="m">
            <ProgressBar
              value={status.progress}
              label="Migration Progress"
              description={status.currentStep}
              status={
                status.status === 'COMPLETED'
                  ? 'success'
                  : status.status === 'FAILED'
                  ? 'error'
                  : 'in-progress'
              }
              additionalInfo={`Status: ${status.status}${
                migrationId ? ` | Migration ID: ${migrationId}` : ''
              }`}
            />
          </SpaceBetween>
        </Container>
      )}

      {logs.length > 0 && (
        <Container header={<Header variant="h2">Migration Logs</Header>}>
          <Box variant="code">
            {logs.map((log, i) => (
              <div
                key={i}
                style={{ padding: '2px 0', fontSize: '13px', fontFamily: 'monospace' }}
              >
                {log}
              </div>
            ))}
          </Box>
        </Container>
      )}
    </SpaceBetween>
  )
}
