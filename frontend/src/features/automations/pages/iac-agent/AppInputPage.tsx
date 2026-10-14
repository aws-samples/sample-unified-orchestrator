import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
  Spinner,
  Alert,
  Box,
} from '@cloudscape-design/components'
import { iacAgentApi, PageState } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'
import { AUTOMATION_IDS } from '../../constants'
import ComposerWizard from './ComposerWizard'
import RuntimeValuesForm from './RuntimeValuesForm'
import SubmitConfirmPanel from './SubmitConfirmPanel'
import CodeReviewPanel from './CodeReviewPanel'
import { useIacDocsPanel } from '../../hooks/useIacDocsPanel'

const POLL_INTERVAL_MS = 4000

export default function AppInputPage() {
  useIacDocsPanel()
  const [searchParams] = useSearchParams()
  const executionId = searchParams.get('execution_id') ?? ''
  const motsId = searchParams.get('mots_id') ?? ''
  const environment = searchParams.get('environment') ?? ''
  const automationId = searchParams.get('automation_id') ?? ''

  const [pageState, setPageState] = useState<PageState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const resolveState = useCallback(async () => {
    if (!motsId || !environment) {
      setError('Missing required URL parameters: mots_id and environment')
      setLoading(false)
      return
    }
    try {
      const { data } = await iacAgentApi.getSessionStatus(motsId, environment, executionId || undefined, 'orchestrator')
      setPageState(data)
      setError(null)
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to resolve page state'))
    } finally {
      setLoading(false)
    }
  }, [motsId, environment])

  useEffect(() => { resolveState() }, [resolveState])

  useEffect(() => {
    if (pageState?.state === 'generating') {
      pollingRef.current = setInterval(resolveState, POLL_INTERVAL_MS)
    }
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null } }
  }, [pageState?.state, resolveState])

  if (automationId && automationId !== AUTOMATION_IDS.TERRAFORM_AGENT) {
    return (
      <ContentLayout header={<Header variant="h1">Unsupported Automation</Header>}>
        <Alert type="error">automation_id "{automationId}" is not supported. Expected "{AUTOMATION_IDS.TERRAFORM_AGENT}".</Alert>
      </ContentLayout>
    )
  }

  if (loading) {
    return (
      <ContentLayout header={<Header variant="h1">Infrastructure Code Generator</Header>}>
        <Container><Box textAlign="center" padding="xl"><Spinner size="large" /><Box variant="p" margin={{ top: 's' }}>Loading...</Box></Box></Container>
      </ContentLayout>
    )
  }

  if (error) {
    return (<ContentLayout header={<Header variant="h1">Infrastructure Code Generator</Header>}><Alert type="error" header="Error">{error}</Alert></ContentLayout>)
  }

  if (!pageState) {
    return (<ContentLayout header={<Header variant="h1">Infrastructure Code Generator</Header>}><Alert type="warning">Unable to determine page state.</Alert></ContentLayout>)
  }

  return (
    <ContentLayout header={<Header variant="h1">Infrastructure Code Generator</Header>}>
      <SpaceBetween size="l">{renderPanel()}</SpaceBetween>
    </ContentLayout>
  )

  function renderPanel() {
    switch (pageState!.state) {
      case 'composer':
        return <ComposerWizard motsId={motsId} onComplete={resolveState} />
      case 'runtime_values':
        return <RuntimeValuesForm motsId={motsId} environment={environment} onComplete={resolveState} />
      case 'confirm':
        return (
          <SubmitConfirmPanel
            motsId={motsId} environment={environment} executionId={executionId}
            onEditRuntimeValues={() => setPageState({ state: 'runtime_values' })}
            onSubmitted={() => { setPageState({ state: 'generating' }) }}
          />
        )
      case 'generating':
        return (
          <Container header={<Header variant="h2">Generating Terraform Code</Header>}>
            <Box textAlign="center" padding="xl">
              <Spinner size="large" />
              <Box variant="p" margin={{ top: 's' }}>Code generation in progress. This may take a few minutes...</Box>
              <Box variant="small" color="text-body-secondary">Session: {pageState!.session_id}</Box>
            </Box>
          </Container>
        )
      case 'review':
        return <CodeReviewPanel sessionId={pageState!.session_id!} currentVersion={pageState!.current_version!} versions={pageState!.versions ?? []} approvedVersion={pageState!.approved_version ?? null} onApproved={resolveState} />
      case 'approved':
        return <CodeReviewPanel sessionId={pageState!.session_id!} currentVersion={pageState!.current_version ?? 'v1'} versions={pageState!.versions ?? []} approvedVersion={pageState!.approved_version ?? null} onApproved={resolveState} readOnly />
      case 'error':
        return <Alert type="error" header="Generation Failed">{pageState!.message ?? 'An error occurred during code generation.'}</Alert>
      default:
        return <Alert type="warning">Unknown state: {pageState!.state}</Alert>
    }
  }
}
