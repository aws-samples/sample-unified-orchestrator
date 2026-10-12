import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Tabs,
  Table,
  StatusIndicator,
  Button,
  Alert,
  Box,
  Spinner,
  Link,
} from '@cloudscape-design/components'
import { iacAgentApi, type SessionSummary } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'
import { ROUTES } from '../../constants'
import CodeReviewPanel from './CodeReviewPanel'
import RuntimeValuesModal from './RuntimeValuesModal'
import { useIacDocsPanel } from '../../hooks/useIacDocsPanel'

interface CatalogRecord {
  app_composition?: string | {
    blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[]
  }
  [key: string]: unknown
}

interface EnvTab {
  environment: string
  sessions: SessionSummary[]
  loading: boolean
  error: string | null
}

function getEnvironmentKeys(record: CatalogRecord): string[] {
  return Object.keys(record)
    .filter((k) => k.endsWith('_runtime_values'))
    .map((k) => k.replace('_runtime_values', ''))
}

function parseComposition(raw: unknown): { blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[] } | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw as ReturnType<typeof parseComposition>
}

function statusType(status: string): 'success' | 'error' | 'warning' | 'info' | 'in-progress' {
  switch (status) {
    case 'approved': return 'success'
    case 'failed':
    case 'error': return 'error'
    case 'generating':
    case 'initializing': return 'in-progress'
    case 'pending':
    case 'awaiting_feedback': return 'warning'
    default: return 'info'
  }
}

export default function SessionHistoryPage() {
  useIacDocsPanel()
  const [searchParams] = useSearchParams()
  const motsId = searchParams.get('mots_id') ?? ''

  const [catalog, setCatalog] = useState<CatalogRecord | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [envTabs, setEnvTabs] = useState<EnvTab[]>([])
  const [activeTab, setActiveTab] = useState('')

  // Code review state
  const [reviewSession, setReviewSession] = useState<SessionSummary | null>(null)

  // Runtime values modal state
  const [runtimeEnv, setRuntimeEnv] = useState('')
  const [showRuntimeModal, setShowRuntimeModal] = useState(false)

  // Load catalog then sessions
  useEffect(() => {
    if (!motsId) return
    let cancelled = false

    const load = async () => {
      setCatalogLoading(true)
      setCatalogError(null)
      try {
        const { data } = await iacAgentApi.getAppCatalog(motsId)
        if (cancelled) return
        const rec = data as CatalogRecord
        setCatalog(rec)

        const envs = getEnvironmentKeys(rec)
        if (envs.length > 0) setActiveTab(envs[0])

        // Init tabs with loading state
        const initial: EnvTab[] = envs.map((e) => ({ environment: e, sessions: [], loading: true, error: null }))
        setEnvTabs(initial)

        // Fetch sessions in parallel
        const results = await Promise.allSettled(
          envs.map((env) => iacAgentApi.listSessions(motsId, env, 5))
        )
        if (cancelled) return

        setEnvTabs(envs.map((env, i) => {
          const r = results[i]
          return {
            environment: env,
            sessions: r.status === 'fulfilled' ? r.value.data : [],
            loading: false,
            error: r.status === 'rejected' ? extractApiError(r.reason, 'Failed to load sessions') : null,
          }
        }))
      } catch (err: unknown) {
        if (cancelled) return
        const msg = extractApiError(err, 'Failed to load app catalog')
        // Detect 404
        const is404 = typeof err === 'object' && err !== null &&
          'response' in err && typeof (err as Record<string, unknown>).response === 'object' &&
          ((err as { response?: { status?: number } }).response?.status === 404)
        setCatalogError(is404 ? 'No app catalog found for this MOTS ID.' : msg)
      } finally {
        if (!cancelled) setCatalogLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [motsId])

  // Missing mots_id
  if (!motsId) {
    return (
      <ContentLayout header={<Header variant="h1">Session History</Header>}>
        <Alert type="warning" header="No MOTS ID specified">
          Navigate to the <Link href={ROUTES.COMPOSITIONS}>App Compositions</Link> page and select an application.
        </Alert>
      </ContentLayout>
    )
  }

  // Loading
  if (catalogLoading) {
    return (
      <ContentLayout header={<Header variant="h1">Session History</Header>}>
        <Box textAlign="center" padding="xl"><Spinner size="large" /></Box>
      </ContentLayout>
    )
  }

  // Catalog error
  if (catalogError) {
    return (
      <ContentLayout header={<Header variant="h1">Session History</Header>}>
        <Alert type="error" header="Error">{catalogError}</Alert>
      </ContentLayout>
    )
  }

  // If viewing code for a session, show CodeReviewPanel
  if (reviewSession) {
    return (
      <ContentLayout header={<Header variant="h1">Session History</Header>}>
        <SpaceBetween size="l">
          <Button variant="link" onClick={() => setReviewSession(null)}>← Back to sessions</Button>
          <CodeReviewPanel
            sessionId={reviewSession.session_id}
            currentVersion={reviewSession.current_version}
            versions={reviewSession.versions}
            approvedVersion={reviewSession.approved_version}
            onApproved={() => {}}
            readOnly
          />
        </SpaceBetween>
      </ContentLayout>
    )
  }

  const composition = catalog ? parseComposition(catalog.app_composition) : null

  return (
    <ContentLayout header={<Header variant="h1">Session History — {motsId}</Header>}>
      <SpaceBetween size="l">
        {envTabs.length === 0 ? (
          <Alert type="info">No environments configured for this application.</Alert>
        ) : (
          <Tabs
            activeTabId={activeTab}
            onChange={({ detail }) => setActiveTab(detail.activeTabId)}
            tabs={envTabs.map((tab) => ({
              id: tab.environment,
              label: tab.environment.toUpperCase(),
              content: renderTabContent(tab, composition),
            }))}
          />
        )}
      </SpaceBetween>

      <RuntimeValuesModal
        visible={showRuntimeModal}
        motsId={motsId}
        environment={runtimeEnv}
        onDismiss={() => setShowRuntimeModal(false)}
      />
    </ContentLayout>
  )

  function renderTabContent(
    tab: EnvTab,
    comp: ReturnType<typeof parseComposition>,
  ) {
    return (
      <SpaceBetween size="l">
        {/* Composition summary */}
        {comp?.blueprints && comp.blueprints.length > 0 && (
          <Box>
            <Box variant="h4">Composition</Box>
            <Box variant="p">
              {comp.blueprints.map((b) => `${b.blueprint_name} (${b.version})`).join(', ')}
            </Box>
          </Box>
        )}

        <Button
          variant="normal"
          onClick={() => {
            setRuntimeEnv(tab.environment)
            setShowRuntimeModal(true)
          }}
        >
          View Runtime Values
        </Button>

        {/* Sessions table */}
        {tab.loading ? (
          <Box textAlign="center" padding="l"><Spinner /></Box>
        ) : tab.error ? (
          <Alert type="error">{tab.error}</Alert>
        ) : (
          <Table
            header={<Header counter={`(${tab.sessions.length})`}>Sessions</Header>}
            items={tab.sessions}
            columnDefinitions={[
              {
                id: 'session_id',
                header: 'Session ID',
                cell: (s) => s.session_id,
              },
              {
                id: 'status',
                header: 'Status',
                cell: (s) => <StatusIndicator type={statusType(s.status)}>{s.status}</StatusIndicator>,
              },
              { id: 'created', header: 'Created', cell: (s) => s.created_at || '—' },
              { id: 'updated', header: 'Updated', cell: (s) => s.updated_at || '—' },
              { id: 'version', header: 'Version', cell: (s) => s.current_version || '—' },
              {
                id: 'actions',
                header: 'Actions',
                cell: (s) => (
                  <Button
                    variant="inline-link"
                    disabled={s.versions.length === 0}
                    onClick={() => setReviewSession(s)}
                  >
                    View Code
                  </Button>
                ),
              },
            ]}
            empty={
              <Box textAlign="center" padding="l">
                <Box variant="p">No sessions found for this environment.</Box>
              </Box>
            }
          />
        )}
      </SpaceBetween>
    )
  }
}
