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
import { buildRepoName } from '../../utils/buildRepoName'
import Editor from '@monaco-editor/react'

interface GenerateConfirmPanelProps {
  motsId: string
  environment: string
  appAcronym: string
  baseBranch: string
  githubOwner: string
  repoNameOverride: string
  itapId: string
  onGenerated: (executionId: string, executionArn?: string) => void
  onEditRuntimeValues?: () => void
  configOverrides?: Record<string, string>
}

export default function GenerateConfirmPanel({
  motsId,
  environment,
  appAcronym,
  baseBranch,
  githubOwner,
  repoNameOverride,
  itapId,
  onGenerated,
  onEditRuntimeValues,
  configOverrides,
}: GenerateConfirmPanelProps) {
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

  const handleGenerate = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const acronym = appAcronym || (catalog?.app_acronym as string) || ''
      const repoName = buildRepoName(itapId, acronym, repoNameOverride)
      if (!repoName) {
        setError('Repo name could not be determined. Provide an iTAP and App Acronym, or a Repo Name Override.')
        setSubmitting(false)
        return
      }
      const { data } = await iacAgentApi.generateDirect(motsId, environment, acronym, repoName, baseBranch || 'main', githubOwner || 'ATT-DP5', configOverrides)
      onGenerated(data.execution_id, data.execution_arn)
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to start generation'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Container header={<Header variant="h2">Confirm &amp; Generate</Header>}>
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
          description="Review your configuration and generate Terraform code"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {onEditRuntimeValues && (
                <Button variant="normal" onClick={onEditRuntimeValues} disabled={submitting}>
                  Edit Runtime Values
                </Button>
              )}
              <Button variant="primary" onClick={handleGenerate} loading={submitting} disabled={submitting}>
                Generate
              </Button>
            </SpaceBetween>
          }
        >
          Confirm &amp; Generate
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
              { label: 'Target Repo', value: `${githubOwner || 'ATT-DP5'}/${buildRepoName(itapId, appAcronym, repoNameOverride) || '?'}` },
              { label: 'Base Branch', value: baseBranch || 'main' },
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
