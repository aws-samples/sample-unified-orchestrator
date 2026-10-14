import { useEffect, useState } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Spinner,
  Alert,
  ColumnLayout,
  KeyValuePairs,
  ExpandableSection,
} from '@cloudscape-design/components'
import { iacAgentApi } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'
import Editor from '@monaco-editor/react'

interface SubmitConfirmPanelProps {
  motsId: string
  environment: string
  executionId: string
  onSubmitted: () => void
  onEditRuntimeValues?: () => void
}

export default function SubmitConfirmPanel({
  motsId,
  environment,
  executionId,
  onSubmitted,
  onEditRuntimeValues,
}: SubmitConfirmPanelProps) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await iacAgentApi.getAppCatalog(motsId)
        setCatalog(data)
      } catch {
        setError('Failed to load application data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [motsId])

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await iacAgentApi.resumeInput(executionId, motsId, environment)
      onSubmitted()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { status?: number } }).response
        if (resp?.status === 404) {
          setError('This link has expired or was already used.')
          return
        }
      }
      setError(extractApiError(err, 'Failed to submit'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Container header={<Header variant="h2">Confirm &amp; Submit</Header>}>
        <Box textAlign="center" padding="xl"><Spinner size="large" /></Box>
      </Container>
    )
  }

  const composition = (catalog as Record<string, unknown>)?.app_composition as {
    blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[]
  } | undefined

  const runtimeValues = (catalog as Record<string, unknown>)?.[`${environment}_runtime_values`] as
    Record<string, unknown> | undefined

  return (
    <Container
      header={
        <Header
          variant="h2"
          description="Review your configuration and submit to start code generation"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {onEditRuntimeValues && (
                <Button variant="normal" onClick={onEditRuntimeValues} disabled={submitting}>
                  Edit Runtime Values
                </Button>
              )}
              <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={submitting}>
                Submit
              </Button>
            </SpaceBetween>
          }
        >
          Confirm &amp; Submit
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && <Alert type="error">{error}</Alert>}

        <ColumnLayout columns={2}>
          <KeyValuePairs
            items={[
              { label: 'MOTS ID', value: motsId },
              { label: 'Environment', value: environment },
              { label: 'Blueprints', value: String(composition?.blueprints?.length ?? 0) },
            ]}
          />
        </ColumnLayout>

        {composition?.blueprints.map((bp) => (
          <ExpandableSection
            key={bp.blueprint_name}
            headerText={`${bp.blueprint_name} (${bp.version})`}
            variant="container"
          >
            <KeyValuePairs
              columns={2}
              items={bp.instances.map((inst) => ({
                label: 'Instance',
                value: inst.instance_name,
              }))}
            />
          </ExpandableSection>
        ))}

        {runtimeValues && (
          <Container header={<Header variant="h3">Runtime Values ({environment})</Header>}>
            <Editor
              height="400px"
              language="json"
              theme="vs-dark"
              value={JSON.stringify(runtimeValues, null, 2)}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </Container>
        )}
      </SpaceBetween>
    </Container>
  )
}
