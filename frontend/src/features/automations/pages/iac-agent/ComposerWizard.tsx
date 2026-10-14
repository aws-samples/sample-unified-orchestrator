import { useEffect, useMemo, useState } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  FormField,
  Select,
  Input,
  Table,
  Box,
  Spinner,
  Alert,
  SelectProps,
} from '@cloudscape-design/components'
import {
  iacAgentApi,
  Blueprint,
  BlueprintSelection,
} from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'

interface ComposerWizardProps {
  motsId: string
  onComplete: () => void
  initialComposition?: BlueprintSelection[]
  onCancel?: () => void
  appAcronym?: string
}

interface InstanceRow {
  instanceName: string
}

interface CompositionEntry {
  blueprint: Blueprint
  instances: InstanceRow[]
}

export default function ComposerWizard({ motsId, onComplete, initialComposition, onCancel, appAcronym }: ComposerWizardProps) {
  const [blueprints, setBlueprints] = useState<Blueprint[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Composition state
  const [entries, setEntries] = useState<CompositionEntry[]>([])
  const [selectedBlueprintName, setSelectedBlueprintName] = useState<SelectProps.Option | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<SelectProps.Option | null>(null)
  const [newInstanceName, setNewInstanceName] = useState('')

  useEffect(() => {
    const fetchBlueprints = async () => {
      try {
        const { data } = await iacAgentApi.listBlueprints()
        setBlueprints(data)

        // Pre-populate entries from initialComposition if provided
        if (initialComposition && initialComposition.length > 0) {
          const initial: CompositionEntry[] = initialComposition
            .map((sel) => {
              const bp = data.find(
                (b) => b.blueprint_name === sel.blueprint_name && b.version === sel.version
              )
              if (!bp) return null
              return {
                blueprint: bp,
                instances: sel.instances.map((i) => ({ instanceName: i.instance_name })),
              }
            })
            .filter((e): e is CompositionEntry => e !== null)
          setEntries(initial)
        }
      } catch {
        setError('Failed to load blueprints')
      } finally {
        setLoading(false)
      }
    }
    fetchBlueprints()
  }, [])

  // Unique blueprint names for the first dropdown
  const blueprintNameOptions: SelectProps.Option[] = useMemo(() => {
    const seen = new Set<string>()
    return blueprints
      .filter((bp) => {
        if (seen.has(bp.blueprint_name)) return false
        seen.add(bp.blueprint_name)
        return true
      })
      .map((bp) => ({
        label: bp.blueprint_name,
        value: bp.blueprint_name,
        description: bp.description ?? '',
      }))
  }, [blueprints])

  // Versions available for the selected blueprint name
  const versionOptions: SelectProps.Option[] = useMemo(() => {
    if (!selectedBlueprintName?.value) return []
    return blueprints
      .filter((bp) => bp.blueprint_name === selectedBlueprintName.value)
      .map((bp) => ({
        label: bp.version,
        value: bp.version,
      }))
  }, [blueprints, selectedBlueprintName])

  // Auto-select latest version when blueprint name changes
  useEffect(() => {
    if (!selectedBlueprintName?.value) {
      setSelectedVersion(null)
      return
    }
    const versions = blueprints
      .filter((bp) => bp.blueprint_name === selectedBlueprintName.value)
      .map((bp) => bp.version)
      .sort()
    const latest = versions[versions.length - 1]
    if (latest) {
      setSelectedVersion({ label: latest, value: latest })
    } else {
      setSelectedVersion(null)
    }
  }, [selectedBlueprintName, blueprints])

  const addInstance = () => {
    if (!selectedBlueprintName?.value || !selectedVersion?.value || !newInstanceName.trim()) return

    const bpName = selectedBlueprintName.value
    const bpVersion = selectedVersion.value
    const bp = blueprints.find(
      (b) => b.blueprint_name === bpName && b.version === bpVersion
    )
    if (!bp) return

    // Check for duplicate instance name across all entries
    const allNames = entries.flatMap((e) => e.instances.map((i) => i.instanceName))
    if (allNames.includes(newInstanceName.trim())) {
      setError(`Instance name "${newInstanceName.trim()}" is already used`)
      return
    }

    setEntries((prev) => {
      const existing = prev.find(
        (e) => e.blueprint.blueprint_name === bpName && e.blueprint.version === bpVersion
      )
      if (existing) {
        return prev.map((e) =>
          e === existing
            ? { ...e, instances: [...e.instances, { instanceName: newInstanceName.trim() }] }
            : e
        )
      }
      return [...prev, { blueprint: bp, instances: [{ instanceName: newInstanceName.trim() }] }]
    })

    setNewInstanceName('')
    setError(null)
  }

  const removeInstance = (bpName: string, bpVersion: string, instanceName: string) => {
    setEntries((prev) =>
      prev
        .map((e) => {
          if (e.blueprint.blueprint_name === bpName && e.blueprint.version === bpVersion) {
            return { ...e, instances: e.instances.filter((i) => i.instanceName !== instanceName) }
          }
          return e
        })
        .filter((e) => e.instances.length > 0)
    )
  }

  const handleSave = async () => {
    if (entries.length === 0) {
      setError('Add at least one blueprint instance')
      return
    }
    if (entries.length > 10) {
      setError('Maximum 10 blueprints allowed')
      return
    }

    const payload: { blueprints: BlueprintSelection[]; app_acronym?: string } = {
      blueprints: entries.map((e) => ({
        blueprint_name: e.blueprint.blueprint_name,
        version: e.blueprint.version,
        instances: e.instances.map((i) => ({ instance_name: i.instanceName })),
      })),
      ...(appAcronym ? { app_acronym: appAcronym } : {}),
    }

    setSaving(true)
    setError(null)
    try {
      await iacAgentApi.saveComposition(motsId, payload)
      onComplete()
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to save composition'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Container header={<Header variant="h2">Compose Application</Header>}>
        <Box textAlign="center" padding="xl"><Spinner size="large" /></Box>
      </Container>
    )
  }

  // Flatten entries for table display
  const tableItems = entries.flatMap((e) =>
    e.instances.map((inst) => ({
      blueprintName: e.blueprint.blueprint_name,
      version: e.blueprint.version,
      instanceName: inst.instanceName,
    }))
  )

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Select blueprints and name instances for your application"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {onCancel && (
                <Button variant="normal" onClick={onCancel}>Cancel</Button>
              )}
              <Button variant="primary" onClick={handleSave} loading={saving} disabled={entries.length === 0}>
                Save Composition
              </Button>
            </SpaceBetween>
          }
        >
          Compose Application
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && <Alert type="error" dismissible onDismiss={() => setError(null)}>{error}</Alert>}

        <SpaceBetween size="s" direction="horizontal">
          <FormField label="Blueprint">
            <Select
              selectedOption={selectedBlueprintName}
              onChange={({ detail }) => setSelectedBlueprintName(detail.selectedOption)}
              options={blueprintNameOptions}
              placeholder="Select a blueprint"
              filteringType="auto"
            />
          </FormField>
          <FormField label="Version">
            <Select
              selectedOption={selectedVersion}
              onChange={({ detail }) => setSelectedVersion(detail.selectedOption)}
              options={versionOptions}
              placeholder="Version"
              disabled={!selectedBlueprintName}
            />
          </FormField>
          <FormField label="Instance Name">
            <Input
              value={newInstanceName}
              onChange={({ detail }) => setNewInstanceName(detail.value)}
              placeholder="e.g. web-server-1"
              onKeyDown={({ detail }) => { if (detail.key === 'Enter') addInstance() }}
            />
          </FormField>
          <Box padding={{ top: 'xl' }}>
            <Button onClick={addInstance} disabled={!selectedBlueprintName || !selectedVersion || !newInstanceName.trim()}>
              Add Instance
            </Button>
          </Box>
        </SpaceBetween>

        <Table
          items={tableItems}
          columnDefinitions={[
            { id: 'blueprint', header: 'Blueprint', cell: (item) => item.blueprintName },
            { id: 'version', header: 'Version', cell: (item) => item.version },
            { id: 'instance', header: 'Instance Name', cell: (item) => item.instanceName },
            {
              id: 'actions',
              header: 'Actions',
              cell: (item) => (
                <Button variant="icon" iconName="remove" onClick={() => removeInstance(item.blueprintName, item.version, item.instanceName)} />
              ),
            },
          ]}
          empty={<Box textAlign="center" padding="l">No blueprint instances added yet.</Box>}
        />
      </SpaceBetween>
    </Container>
  )
}
