import { useState, useEffect } from 'react'
import Table from '@cloudscape-design/components/table'
import Header from '@cloudscape-design/components/header'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Box from '@cloudscape-design/components/box'
import Select, { SelectProps } from '@cloudscape-design/components/select'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import Alert from '@cloudscape-design/components/alert'
import Badge from '@cloudscape-design/components/badge'
import { listMigrations, stopReplication, refreshStats } from '../services/api'

interface Migration {
  migrationId: string
  status: string
  migrationType: string
  databaseType: string
  sourceDatabase: string
  targetDatabase: string
  sourceServer: string
  targetServer: string
  createdAt: string
  completedAt: string
  updatedAt: string
  tableCount?: number
  rowCount?: number
  viewCount?: number
  functionCount?: number
  indexCount?: number
  dbSize?: number
  progress: number
  currentStep: string
  error?: string
}

export function MigrationHistory() {
  const [migrations, setMigrations] = useState<Migration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const fetchMigrations = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await listMigrations()
      setMigrations(data.migrations || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load migrations')
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchMigrations()
  }, [])

  const handleStopReplication = async (migrationId: string) => {
    if (
      !confirm(
        'Are you sure you want to stop this replication? This will drop the subscription on target and publication on source.'
      )
    )
      return
    setStoppingId(migrationId)
    try {
      await stopReplication(migrationId)
      setMigrations((prev) =>
        prev.map((m) =>
          m.migrationId === migrationId ? { ...m, status: 'REPLICATION_STOPPED' } : m
        )
      )
    } catch (e: any) {
      alert(`Failed: ${e.response?.data?.error || e.message || 'Unknown error'}`)
    }
    setStoppingId(null)
  }

  const handleRefreshStats = async (migrationId: string) => {
    setRefreshingId(migrationId)
    try {
      const stats = await refreshStats(migrationId)
      setMigrations((prev) =>
        prev.map((m) => (m.migrationId === migrationId ? { ...m, ...stats } : m))
      )
    } catch {
      /* silent */
    }
    setRefreshingId(null)
  }

  const formatDate = (d: string) => {
    if (!d) return '-'
    try {
      return new Date(d).toLocaleString()
    } catch {
      return d
    }
  }

  const formatSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '-'
    if (bytes > 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB'
    if (bytes > 1048576) return (bytes / 1048576).toFixed(0) + ' MB'
    return (bytes / 1024).toFixed(0) + ' KB'
  }

  const getStatusType = (
    s: string
  ):
    | 'success'
    | 'error'
    | 'in-progress'
    | 'warning'
    | 'info'
    | 'stopped'
    | 'pending'
    | 'loading' => {
    if (s === 'COMPLETED') return 'success'
    if (s === 'FAILED' || s === 'VERIFICATION_FAILED') return 'error'
    if (s === 'REPLICATION_STOPPED') return 'stopped'
    if (s.includes('IN_PROGRESS') || s.includes('EXPORT') || s.includes('IMPORT') || s.includes('TRANSFER'))
      return 'in-progress'
    return 'warning'
  }

  const isActiveReplication = (m: Migration) =>
    m.migrationType === 'replication' && m.status === 'COMPLETED'

  const filtered = migrations.filter((m) => {
    if (filter !== 'all' && m.status !== filter) return false
    if (typeFilter !== 'all' && m.migrationType !== typeFilter) return false
    return true
  })

  const statusCounts = migrations.reduce(
    (acc, m) => {
      if (m.status === 'COMPLETED') acc.completed++
      else if (m.status === 'FAILED' || m.status === 'VERIFICATION_FAILED') acc.failed++
      else if (m.status === 'REPLICATION_STOPPED') acc.stopped++
      else acc.active++
      return acc
    },
    { completed: 0, failed: 0, active: 0, stopped: 0 }
  )

  const statusFilterOptions: SelectProps.Option[] = [
    { value: 'all', label: 'All Statuses' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'FAILED', label: 'Failed' },
    { value: 'REPLICATION_STOPPED', label: 'Replication Stopped' },
    { value: 'VERIFICATION_FAILED', label: 'Verification Failed' },
  ]

  const typeFilterOptions: SelectProps.Option[] = [
    { value: 'all', label: 'All Types' },
    { value: 'logical', label: 'Logical' },
    { value: 'replication', label: 'Replication (CDC)' },
    { value: 'physical', label: 'Physical' },
  ]

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Summary</Header>}>
        <ColumnLayout columns={4}>
          <Box textAlign="center">
            <Box variant="h1" color="text-status-info">
              {migrations.length}
            </Box>
            <Box variant="small">Total Migrations</Box>
          </Box>
          <Box textAlign="center">
            <Box variant="h1" color="text-status-success">
              {statusCounts.completed}
            </Box>
            <Box variant="small">Completed</Box>
          </Box>
          <Box textAlign="center">
            <Box variant="h1" color="text-status-error">
              {statusCounts.failed}
            </Box>
            <Box variant="small">Failed</Box>
          </Box>
          <Box textAlign="center">
            <Box variant="h1" color="text-status-warning">
              {statusCounts.active}
            </Box>
            <Box variant="small">In Progress</Box>
          </Box>
        </ColumnLayout>
      </Container>

      {error && <Alert type="error">{error}</Alert>}

      <Table
        header={
          <Header
            variant="h2"
            counter={`(${filtered.length})`}
            actions={
              <Button onClick={fetchMigrations} loading={loading} iconName="refresh">
                Refresh
              </Button>
            }
          >
            Migration History
          </Header>
        }
        filter={
          <SpaceBetween direction="horizontal" size="m">
            <Select
              selectedOption={statusFilterOptions.find((o) => o.value === filter) || null}
              onChange={({ detail }) => setFilter(detail.selectedOption.value || 'all')}
              options={statusFilterOptions}
            />
            <Select
              selectedOption={typeFilterOptions.find((o) => o.value === typeFilter) || null}
              onChange={({ detail }) => setTypeFilter(detail.selectedOption.value || 'all')}
              options={typeFilterOptions}
            />
          </SpaceBetween>
        }
        loading={loading}
        loadingText="Loading migrations..."
        items={filtered}
        empty={
          <Box textAlign="center" padding="l">
            No migrations found
          </Box>
        }
        columnDefinitions={[
          {
            id: 'database',
            header: 'Database',
            cell: (m) => (
              <SpaceBetween size="xxs">
                <Box fontWeight="bold">
                  {m.sourceDatabase || 'Unknown'} → {m.targetDatabase || m.sourceDatabase || 'Unknown'}
                </Box>
                <SpaceBetween direction="horizontal" size="xxs">
                  <Badge color="blue">{m.databaseType}</Badge>
                  <Badge color="grey">{m.migrationType}</Badge>
                  {isActiveReplication(m) && <Badge color="green">Replicating</Badge>}
                </SpaceBetween>
              </SpaceBetween>
            ),
            sortingField: 'sourceDatabase',
            width: 280,
          },
          {
            id: 'status',
            header: 'Status',
            cell: (m) => <StatusIndicator type={getStatusType(m.status)}>{m.status}</StatusIndicator>,
            sortingField: 'status',
            width: 180,
          },
          {
            id: 'created',
            header: 'Created',
            cell: (m) => formatDate(m.createdAt),
            sortingField: 'createdAt',
            width: 180,
          },
          {
            id: 'stats',
            header: 'Stats',
            cell: (m) => (
              <SpaceBetween size="xxs">
                {m.tableCount != null && <span>Tables: {m.tableCount}</span>}
                {m.rowCount != null && <span>Rows: {m.rowCount?.toLocaleString()}</span>}
                {m.viewCount != null && m.viewCount > 0 && <span>Views: {m.viewCount}</span>}
                {m.functionCount != null && m.functionCount > 0 && (
                  <span>Functions: {m.functionCount}</span>
                )}
                {m.indexCount != null && m.indexCount > 0 && <span>Indexes: {m.indexCount}</span>}
                {m.dbSize != null && m.dbSize > 0 && <span>Size: {formatSize(m.dbSize)}</span>}
              </SpaceBetween>
            ),
            width: 200,
          },
          {
            id: 'details',
            header: 'Details',
            cell: (m) => (
              <SpaceBetween size="xxs">
                {m.sourceServer && <span>Source: {m.sourceServer}</span>}
                {m.targetServer && <span>Target: {m.targetServer}</span>}
                {m.currentStep && <span>Step: {m.currentStep}</span>}
                {m.error && <Box color="text-status-error">{m.error}</Box>}
                <Box variant="small" color="text-body-secondary">
                  ID: {m.migrationId}
                </Box>
                <SpaceBetween direction="horizontal" size="xs">
                  {isActiveReplication(m) && (
                    <Button
                      onClick={() => handleStopReplication(m.migrationId)}
                      loading={stoppingId === m.migrationId}
                      variant="primary"
                    >
                      Stop Replication
                    </Button>
                  )}
                  {(m.status === 'COMPLETED' || m.status === 'REPLICATION_STOPPED') && (
                    <Button
                      onClick={() => handleRefreshStats(m.migrationId)}
                      loading={refreshingId === m.migrationId}
                      iconName="refresh"
                    >
                      Refresh Stats
                    </Button>
                  )}
                </SpaceBetween>
              </SpaceBetween>
            ),
            width: 300,
          },
        ]}
      />
    </SpaceBetween>
  )
}
