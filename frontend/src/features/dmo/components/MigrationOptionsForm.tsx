import { useState, useEffect } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Select, { SelectProps } from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Checkbox from '@cloudscape-design/components/checkbox'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import { useMigrationStore } from '../store/migrationStore'

interface MigrationOptionsFormProps {
  onNext: () => void
  onPrev: () => void
}

export const MigrationOptionsForm = ({ onNext, onPrev }: MigrationOptionsFormProps) => {
  void onNext
  void onPrev
  const { options, updateOptions, configVersion } = useMigrationStore()
  const [f, setF] = useState({ ...options })

  useEffect(() => {
    setF({ ...options })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configVersion])

  const up = (path: string, value: any) => {
    setF((prev) => {
      const copy = { ...prev } as any
      const parts = path.split('.')
      if (parts.length === 1) {
        copy[parts[0]] = value
      } else {
        copy[parts[0]] = { ...copy[parts[0]], [parts[1]]: value }
      }
      updateOptions(copy)
      return copy
    })
  }

  const migrationTypeOptions: SelectProps.Option[] = [
    {
      value: 'physical',
      label: 'Physical Migration (Native Backup/Restore)',
      description: 'Uses native database backup files for fast, complete migration (same DB engine).',
    },
    {
      value: 'logical',
      label: 'Logical Migration (Schema + Data Export)',
      description: 'Exports schema and data as SQL scripts (supports cross-platform migrations).',
    },
    {
      value: 'replication',
      label: 'Replication (Continuous Data Sync)',
      description: 'Provides continuous data synchronization between source and target databases.',
    },
  ]

  const backupTypeOptions: SelectProps.Option[] = [
    { value: 'full', label: 'Full Backup' },
    { value: 'differential', label: 'Differential Backup' },
    { value: 'incremental', label: 'Incremental Backup' },
  ]

  const scopeOptions: SelectProps.Option[] = [
    { value: 'full', label: 'Full Database' },
    { value: 'schema', label: 'Schema Only' },
    { value: 'tables', label: 'Tables Only' },
  ]

  const replicationTypeOptions: SelectProps.Option[] = [
    { value: 'transactional', label: 'Transactional Replication' },
    { value: 'snapshot', label: 'Snapshot Replication' },
    { value: 'merge', label: 'Merge Replication' },
  ]

  const conflictOptions: SelectProps.Option[] = [
    { value: 'source-wins', label: 'Source Wins' },
    { value: 'target-wins', label: 'Target Wins' },
    { value: 'latest-wins', label: 'Latest Timestamp Wins' },
    { value: 'manual', label: 'Manual Resolution' },
  ]

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Migration Type</Header>}>
        <FormField label="Select Migration Type">
          <Select
            selectedOption={migrationTypeOptions.find((o) => o.value === f.migrationType) || null}
            onChange={({ detail }) => up('migrationType', detail.selectedOption.value)}
            options={migrationTypeOptions}
          />
        </FormField>
      </Container>

      {f.migrationType === 'physical' && (
        <>
          <Container header={<Header variant="h2">Physical Backup Options</Header>}>
            <SpaceBetween size="m">
              <FormField
                label="Backup Type"
                description="Full: Complete database backup | Differential: Changes since last full | Incremental: Transaction logs"
              >
                <Select
                  selectedOption={
                    backupTypeOptions.find((o) => o.value === f.physical.backupType) || null
                  }
                  onChange={({ detail }) => up('physical.backupType', detail.selectedOption.value)}
                  options={backupTypeOptions}
                />
              </FormField>
              <SpaceBetween size="xs">
                <Checkbox
                  checked={f.physical.compression}
                  onChange={({ detail }) => up('physical.compression', detail.checked)}
                >
                  Enable Compression
                </Checkbox>
                <Checkbox
                  checked={f.physical.checksum}
                  onChange={({ detail }) => up('physical.checksum', detail.checked)}
                >
                  Verify Checksum
                </Checkbox>
              </SpaceBetween>
            </SpaceBetween>
          </Container>
          <Container header={<Header variant="h2">Restore Options</Header>}>
            <SpaceBetween size="xs">
              <Checkbox
                checked={f.physical.replaceExisting}
                onChange={({ detail }) => up('physical.replaceExisting', detail.checked)}
              >
                Replace Existing Database
              </Checkbox>
              <Checkbox
                checked={f.physical.verifyOnly}
                onChange={({ detail }) => up('physical.verifyOnly', detail.checked)}
              >
                Verify Backup Only (Don't Restore)
              </Checkbox>
            </SpaceBetween>
          </Container>
        </>
      )}

      {f.migrationType === 'logical' && (
        <>
          <Container header={<Header variant="h2">Logical Migration Scope</Header>}>
            <FormField
              label="Select What to Migrate"
              description="Full: Everything | Schema: Structure only | Tables: Tables with data"
            >
              <Select
                selectedOption={scopeOptions.find((o) => o.value === f.logical.scope) || null}
                onChange={({ detail }) => up('logical.scope', detail.selectedOption.value)}
                options={scopeOptions}
              />
            </FormField>
          </Container>
          <Container header={<Header variant="h2">Data Migration Settings</Header>}>
            <SpaceBetween size="m">
              <Checkbox
                checked={f.logical.fastMode}
                onChange={({ detail }) => up('logical.fastMode', detail.checked)}
                description="Uses multi-threaded tools for 3-8x faster migration. Recommended for databases over 1GB."
              >
                Enable Fast Mode (mydumper/parallel pg_dump)
              </Checkbox>
              <ColumnLayout columns={2}>
                <FormField
                  label="Batch Size (rows per transaction)"
                  description="Number of rows to insert per transaction"
                >
                  <Input
                    type="number"
                    value={String(f.logical.batchSize)}
                    onChange={({ detail }) =>
                      up('logical.batchSize', Number(detail.value) || 1000)
                    }
                  />
                </FormField>
                <FormField
                  label="Parallel Threads"
                  description="Number of parallel threads for data migration"
                >
                  <Input
                    type="number"
                    value={String(f.logical.parallelThreads)}
                    onChange={({ detail }) =>
                      up(
                        'logical.parallelThreads',
                        Math.min(16, Math.max(1, Number(detail.value) || 4))
                      )
                    }
                  />
                </FormField>
              </ColumnLayout>
            </SpaceBetween>
          </Container>
        </>
      )}

      {f.migrationType === 'replication' && (
        <>
          <Container header={<Header variant="h2">Replication Options</Header>}>
            <SpaceBetween size="m">
              <FormField
                label="Replication Type"
                description="Transactional: Real-time continuous | Snapshot: Periodic full refresh | Merge: Bi-directional sync"
              >
                <Select
                  selectedOption={
                    replicationTypeOptions.find((o) => o.value === f.replication.type) || null
                  }
                  onChange={({ detail }) => up('replication.type', detail.selectedOption.value)}
                  options={replicationTypeOptions}
                />
              </FormField>
              <ColumnLayout columns={2}>
                <FormField
                  label="Sync Interval (seconds)"
                  description="How often to synchronize data changes"
                >
                  <Input
                    type="number"
                    value={String(f.replication.syncInterval)}
                    onChange={({ detail }) =>
                      up('replication.syncInterval', Number(detail.value) || 60)
                    }
                  />
                </FormField>
                <FormField
                  label="Conflict Resolution"
                  description="How to handle data conflicts during merge"
                >
                  <Select
                    selectedOption={
                      conflictOptions.find((o) => o.value === f.replication.conflictResolution) ||
                      null
                    }
                    onChange={({ detail }) =>
                      up('replication.conflictResolution', detail.selectedOption.value)
                    }
                    options={conflictOptions}
                  />
                </FormField>
              </ColumnLayout>
            </SpaceBetween>
          </Container>
          <Container header={<Header variant="h2">Replication Scope</Header>}>
            <SpaceBetween size="xs">
              <Checkbox
                checked={f.replication.includeTables}
                onChange={({ detail }) => up('replication.includeTables', detail.checked)}
              >
                Replicate Tables
              </Checkbox>
              <Checkbox
                checked={f.replication.includeViews}
                onChange={({ detail }) => up('replication.includeViews', detail.checked)}
              >
                Replicate Views
              </Checkbox>
              <Checkbox
                checked={f.replication.includeStoredProcs}
                onChange={({ detail }) => up('replication.includeStoredProcs', detail.checked)}
              >
                Replicate Stored Procedures
              </Checkbox>
              <Checkbox
                checked={f.replication.includeFunctions}
                onChange={({ detail }) => up('replication.includeFunctions', detail.checked)}
              >
                Replicate Functions
              </Checkbox>
            </SpaceBetween>
          </Container>
          <Container header={<Header variant="h2">Advanced Replication Settings</Header>}>
            <SpaceBetween size="xs">
              <Checkbox
                checked={f.replication.enableCompression}
                onChange={({ detail }) => up('replication.enableCompression', detail.checked)}
              >
                Enable Data Compression
              </Checkbox>
              <Checkbox
                checked={f.replication.enableEncryption}
                onChange={({ detail }) => up('replication.enableEncryption', detail.checked)}
              >
                Enable Encryption in Transit
              </Checkbox>
              <Checkbox
                checked={f.replication.monitorLatency}
                onChange={({ detail }) => up('replication.monitorLatency', detail.checked)}
              >
                Monitor Replication Latency
              </Checkbox>
              <Checkbox
                checked={f.replication.autoRestart}
                onChange={({ detail }) => up('replication.autoRestart', detail.checked)}
              >
                Auto-Restart on Failure
              </Checkbox>
            </SpaceBetween>
          </Container>
        </>
      )}

      <Container header={<Header variant="h2">Security & Users</Header>}>
        <SpaceBetween size="xs">
          <Checkbox
            checked={f.security.users}
            onChange={({ detail }) => up('security.users', detail.checked)}
          >
            Migrate Users & Roles
          </Checkbox>
          <Checkbox
            checked={f.security.permissions}
            onChange={({ detail }) => up('security.permissions', detail.checked)}
          >
            Migrate Permissions
          </Checkbox>
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Advanced Options</Header>}>
        <SpaceBetween size="xs">
          <Checkbox
            checked={f.advanced.dropExisting}
            onChange={({ detail }) => up('advanced.dropExisting', detail.checked)}
          >
            Drop Existing Objects on Target
          </Checkbox>
          <Checkbox
            checked={f.advanced.verifyData}
            onChange={({ detail }) => up('advanced.verifyData', detail.checked)}
          >
            Verify Data After Migration
          </Checkbox>
          <Checkbox
            checked={f.advanced.createBackup}
            onChange={({ detail }) => up('advanced.createBackup', detail.checked)}
          >
            Create Backup Before Migration
          </Checkbox>
          <Checkbox
            checked={f.advanced.dryRun}
            onChange={({ detail }) => up('advanced.dryRun', detail.checked)}
          >
            Dry Run (Simulate Only)
          </Checkbox>
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  )
}
