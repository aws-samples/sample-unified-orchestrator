import { useEffect, useRef, useState } from 'react'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
  FormField,
  Input,
  Button,
  Table,
  Alert,
  StatusIndicator,
  Box,
  ExpandableSection,
  KeyValuePairs,
  Spinner,
} from '@cloudscape-design/components'
import { adsGeneratorApi, AdsExecution } from '../../services/adsGenerator'
import { extractApiError } from '../../utils/extractApiError'

const POLL_INTERVAL_MS = 3500

const ACCEPTED_FILE_EXTENSIONS = '.xlsx,.xlsm,.docx,.csv,.json,.txt,.md'
const ACCEPTED_DIAGRAM_EXTENSIONS = '.png'

type ViewState = 'search' | 'generate' | 'generating' | 'done' | 'failed'

// Ordered pipeline of Step Function states the API may report via current_state.
// Each entry maps the SF state name -> the user-facing label rendered in the
// "Generating ADS document" stepper. Order matches the actual pipeline so we
// can mark earlier steps "done" when a later state is reported.
const GENERATION_STEPS: ReadonlyArray<{ state: string; label: string }> = [
  { state: 'SnowflakeDataLambda', label: 'Loading Data' },
  { state: 'ExtractAndPrepareLambda', label: 'Extracting and Preparing Input Data' },
  { state: 'SynthesizeLambda', label: 'Inferring Slide Data' },
  { state: 'RenderLambda', label: 'Rendering Powerpoint Slides' },
  { state: 'OutputHandlerLambda', label: 'Publishing Generated Powerpoint' },
] as const

type StepStatus = 'pending' | 'in-progress' | 'done' | 'error'

// Shape of the summary returned by the render Lambda. Loose typing because
// orchestration-core passes it through output_metadata as Record<string, unknown>.
interface GenerationSummary {
  slides_modified: number
  total_replacements: number
  tbd_count: number
  unreplaced_count: number
  tbd_tokens: string[]
  unreplaced: string[]
  app_acronym?: string
  mots_id?: string
}

export default function AdsGeneratorPage() {
  // Core state
  const [view, setView] = useState<ViewState>('search')
  const [itapId, setItapId] = useState('')
  const [executions, setExecutions] = useState<AdsExecution[]>([])
  const [currentExecutionId, setCurrentExecutionId] = useState('')
  const [currentSummary, setCurrentSummary] = useState<GenerationSummary | null>(null)
  const [currentSfState, setCurrentSfState] = useState<string | null>(null)

  // File state — single multi-file uploader for ADS application data files
  const [applicationFiles, setApplicationFiles] = useState<File[]>([])
  // Optional: existing architecture diagram (.png). When present, the render
  // Lambda swaps it onto slide 3 of the generated deck. Apps without an
  // existing diagram leave the stock template placeholder in place.
  const [architectureDiagram, setArchitectureDiagram] = useState<File | null>(null)

  // UI state
  const [searchLoading, setSearchLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [downloadLoading, setDownloadLoading] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // File input refs for resetting
  const applicationFilesRef = useRef<HTMLInputElement | null>(null)
  const architectureDiagramRef = useRef<HTMLInputElement | null>(null)

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    const hasRunning = executions.some((e) => e.status === 'RUNNING' || e.status === 'PENDING')

    if (view === 'search' && hasRunning && itapId) {
      pollingRef.current = setInterval(async () => {
        try {
          const { data } = await adsGeneratorApi.listExecutions(itapId)
          setExecutions(data.executions ?? [])
        } catch {
          // Silently ignore polling errors in search view
        }
      }, POLL_INTERVAL_MS)
    } else if (view === 'generating' && currentExecutionId) {
      pollingRef.current = setInterval(async () => {
        try {
          const { data } = await adsGeneratorApi.getExecutionStatus(currentExecutionId)
          if (data.status === 'COMPLETED') {
            setCurrentSummary(extractSummary(data))
            setCurrentSfState(null)
            setView('done')
          } else if (data.status === 'FAILED') {
            setErrorMessage(data.error_message ?? 'Generation failed')
            setView('failed')
          } else {
            // Still running — capture the current SF state so the stepper
            // can advance. Field is optional (may be undefined or null).
            setCurrentSfState(data.current_state ?? null)
          }
        } catch (err) {
          setErrorMessage(extractApiError(err, 'Failed to check generation status'))
          setView('failed')
        }
      }, POLL_INTERVAL_MS)
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [view, executions, currentExecutionId, itapId])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSearch = async () => {
    if (!itapId.trim()) {
      setValidationErrors({ itapId: 'ITAP ID is required' })
      return
    }
    setValidationErrors({})
    setErrorMessage('')
    setSearchLoading(true)
    try {
      const { data } = await adsGeneratorApi.listExecutions(itapId.trim())
      setExecutions(data.executions ?? [])
    } catch (err) {
      setErrorMessage(extractApiError(err, 'Failed to search executions'))
    } finally {
      setSearchLoading(false)
    }
  }

  const handleGenerate = async () => {
    const errors: Record<string, string> = {}
    if (!itapId.trim()) errors.itapId = 'ITAP ID is required'
    if (applicationFiles.length === 0) {
      errors.applicationFiles = 'Upload at least one application data file'
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      return
    }

    setValidationErrors({})
    setErrorMessage('')
    setGenerateLoading(true)
    try {
      const { data } = await adsGeneratorApi.startGeneration(
        itapId.trim(),
        applicationFiles,
        architectureDiagram,
      )
      setCurrentExecutionId(data.execution_id)
      setCurrentSummary(null)
      setCurrentSfState(null)
      setView('generating')
    } catch (err) {
      setErrorMessage(extractApiError(err, 'Failed to start generation'))
    } finally {
      setGenerateLoading(false)
    }
  }

  const handleDownload = async (executionId: string) => {
    setDownloadLoading(executionId)
    setErrorMessage('')
    try {
      const response = await adsGeneratorApi.downloadDocument(executionId)
      const disposition = response.headers['content-disposition']
      const filenameFromHeader = disposition
        ? disposition.split('filename=')[1]?.replace(/"/g, '')
        : undefined
      const fallback = `AWS-ADS-${itapId.trim() || executionId}.pptx`
      const filename = filenameFromHeader && filenameFromHeader.length > 0 ? filenameFromHeader : fallback
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setErrorMessage(extractApiError(err, 'Download failed'))
    } finally {
      setDownloadLoading(null)
    }
  }

  const handleBackToSearch = () => {
    setView('search')
    setCurrentExecutionId('')
    setCurrentSummary(null)
    setCurrentSfState(null)
    setErrorMessage('')
    setApplicationFiles([])
    setArchitectureDiagram(null)
    if (applicationFilesRef.current) applicationFilesRef.current.value = ''
    if (architectureDiagramRef.current) architectureDiagramRef.current.value = ''
  }

  // ---------------------------------------------------------------------------
  // Table column definitions
  // ---------------------------------------------------------------------------

  const columnDefinitions = [
    {
      id: 'datetime',
      header: 'Date/Time',
      cell: (item: AdsExecution) =>
        item.created_at ? new Date(item.created_at).toLocaleString() : '—',
      sortingField: 'created_at',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item: AdsExecution) => {
        const typeMap: Record<string, 'success' | 'in-progress' | 'error'> = {
          COMPLETED: 'success',
          RUNNING: 'in-progress',
          PENDING: 'in-progress',
          FAILED: 'error',
        }
        return (
          <StatusIndicator type={typeMap[item.status] ?? 'info'}>
            {item.status}
          </StatusIndicator>
        )
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (item: AdsExecution) =>
        item.status === 'COMPLETED' ? (
          <Button
            variant="inline-link"
            loading={downloadLoading === item.execution_id}
            onClick={() => handleDownload(item.execution_id)}
          >
            Download
          </Button>
        ) : null,
    },
  ]

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Generate a 16-slide AWS Application Design Specification (ADS) PowerPoint from raw application data files."
        >
          ADS Generator
        </Header>
      }
    >
      <SpaceBetween size="l">
        {errorMessage && (
          <Alert type="error" dismissible onDismiss={() => setErrorMessage('')}>
            {errorMessage}
          </Alert>
        )}

        {view === 'search' && (
          <>
            <Container header={<Header variant="h2">Search Executions</Header>}>
              <SpaceBetween size="l">
                <FormField label="ITAP ID" errorText={validationErrors.itapId}>
                  <SpaceBetween direction="horizontal" size="xs">
                    <Input
                      value={itapId}
                      onChange={({ detail }) => {
                        setItapId(detail.value)
                        setValidationErrors((prev) => ({ ...prev, itapId: '' }))
                      }}
                      placeholder="Enter ITAP ID"
                    />
                    <Button onClick={handleSearch} loading={searchLoading}>
                      Search
                    </Button>
                  </SpaceBetween>
                </FormField>
                <Button variant="primary" onClick={() => setView('generate')}>
                  + Generate ADS
                </Button>
              </SpaceBetween>
            </Container>

            <Table
              columnDefinitions={columnDefinitions}
              items={executions}
              variant="container"
              header={<Header variant="h2">Execution History</Header>}
              empty={
                <Box textAlign="center" padding={{ vertical: 'xl' }} color="text-body-secondary">
                  No executions found. Search by ITAP ID to view execution history.
                </Box>
              }
            />
          </>
        )}

        {view === 'generate' && (
          <Container header={<Header variant="h2">Generate ADS Document</Header>}>
            <SpaceBetween size="l">
              <FormField label="ITAP ID" errorText={validationErrors.itapId}>
                <Input
                  value={itapId}
                  onChange={({ detail }) => {
                    setItapId(detail.value)
                    setValidationErrors((prev) => ({ ...prev, itapId: '' }))
                  }}
                  placeholder="Enter ITAP ID"
                />
              </FormField>
              <FormField
                label="Application data files"
                description="Upload any combination of UAQ, MOTS questionnaire, CSO, DDD, Snowflake exports, or other application data files. The ADS Generator will extract and synthesize them into the 16-slide ADS deck. Supported: .xlsx, .xlsm, .docx, .csv, .json, .txt, .md."
                errorText={validationErrors.applicationFiles}
              >
                <input
                  ref={applicationFilesRef}
                  type="file"
                  accept={ACCEPTED_FILE_EXTENSIONS}
                  multiple
                  onChange={(e) => {
                    setApplicationFiles(Array.from(e.target.files ?? []))
                    setValidationErrors((prev) => ({ ...prev, applicationFiles: '' }))
                  }}
                />
                {applicationFiles.length > 0 && (
                  <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
                    {applicationFiles.length} file{applicationFiles.length === 1 ? '' : 's'} selected:{' '}
                    {applicationFiles.map((f) => f.name).join(', ')}
                  </Box>
                )}
              </FormField>
              <FormField
                label={
                  <span>
                    Current architecture diagram <i>(optional)</i>
                  </span>
                }
                description="Upload a .png of the application's existing architecture diagram. It will be inserted onto slide 3 of the generated deck. Skip this if no current diagram is available — the stock placeholder will be left in place."
              >
                <input
                  ref={architectureDiagramRef}
                  type="file"
                  accept={ACCEPTED_DIAGRAM_EXTENSIONS}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    setArchitectureDiagram(file)
                  }}
                />
                {architectureDiagram && (
                  <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
                    Selected: {architectureDiagram.name}
                  </Box>
                )}
              </FormField>
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={handleGenerate} loading={generateLoading}>
                  Generate ADS
                </Button>
                <Button variant="link" onClick={handleBackToSearch}>
                  Back to Search
                </Button>
              </SpaceBetween>
            </SpaceBetween>
          </Container>
        )}

        {view === 'generating' && (
          <Container header={<Header variant="h2">Generating ADS Document</Header>}>
            <SpaceBetween size="l">
              <Box padding={{ vertical: 'xl' }}>
                <GenerationStepper currentSfState={currentSfState} />
              </Box>
              <Box textAlign="center">
                <Button variant="link" onClick={handleBackToSearch}>
                  Back to Search
                </Button>
              </Box>
            </SpaceBetween>
          </Container>
        )}

        {view === 'done' && (
          <Container header={<Header variant="h2">Generation Complete</Header>}>
            <SpaceBetween size="l">
              <Box textAlign="center" padding={{ vertical: 'xl' }}>
                <SpaceBetween size="m" direction="vertical" alignItems="center">
                  <StatusIndicator type="success">
                    ADS document generated successfully
                  </StatusIndicator>
                  <Button
                    variant="primary"
                    loading={downloadLoading === currentExecutionId}
                    onClick={() => handleDownload(currentExecutionId)}
                  >
                    Download
                  </Button>
                </SpaceBetween>
              </Box>

              <ExpandableSection
                headerText="Generation summary"
                variant="container"
                defaultExpanded={
                  currentSummary !== null &&
                  (currentSummary.tbd_count > 0 || currentSummary.unreplaced_count > 0)
                }
              >
                {currentSummary === null ? (
                  <Box color="text-body-secondary">Summary not available.</Box>
                ) : (
                  <SpaceBetween size="m">
                    <KeyValuePairs
                      columns={4}
                      items={[
                        {
                          label: 'Slides modified',
                          value: String(currentSummary.slides_modified ?? 0),
                        },
                        {
                          label: 'Placeholders replaced',
                          value: String(currentSummary.total_replacements ?? 0),
                        },
                        {
                          label: 'TBD placeholders',
                          value: (
                            <StatusIndicator
                              type={currentSummary.tbd_count > 0 ? 'warning' : 'success'}
                            >
                              {String(currentSummary.tbd_count ?? 0)}
                            </StatusIndicator>
                          ),
                        },
                        {
                          label: 'Unreplaced placeholders',
                          value: (
                            <StatusIndicator
                              type={currentSummary.unreplaced_count > 0 ? 'error' : 'success'}
                            >
                              {String(currentSummary.unreplaced_count ?? 0)}
                            </StatusIndicator>
                          ),
                        },
                      ]}
                    />

                    {currentSummary.tbd_count > 0 && (
                      <ExpandableSection
                        headerText={`TBD placeholders (${currentSummary.tbd_count})`}
                        variant="footer"
                      >
                        <SpaceBetween size="xs">
                          <Box variant="small" color="text-body-secondary">
                            These fields could not be inferred from the uploaded data and appear
                            in red in the PPTX. Edit them manually after download, or upload
                            additional source documents and regenerate.
                          </Box>
                          <Box variant="code">
                            {currentSummary.tbd_tokens.join(', ')}
                          </Box>
                        </SpaceBetween>
                      </ExpandableSection>
                    )}

                    {currentSummary.unreplaced_count > 0 && (
                      <ExpandableSection
                        headerText={`Unreplaced placeholders (${currentSummary.unreplaced_count})`}
                        variant="footer"
                      >
                        <SpaceBetween size="xs">
                          <Box variant="small" color="text-body-secondary">
                            These tokens were left in the rendered PPTX as literal{' '}
                            <code>{'{{TOKEN}}'}</code> strings. This usually indicates a template
                            or code mismatch and should be reported.
                          </Box>
                          <Box variant="code">
                            {currentSummary.unreplaced.join(', ')}
                          </Box>
                        </SpaceBetween>
                      </ExpandableSection>
                    )}
                  </SpaceBetween>
                )}
              </ExpandableSection>

              <Box textAlign="center">
                <Button variant="link" onClick={handleBackToSearch}>
                  Back to Search
                </Button>
              </Box>
            </SpaceBetween>
          </Container>
        )}

        {view === 'failed' && (
          <Container header={<Header variant="h2">Generation Failed</Header>}>
            <SpaceBetween size="l">
              <Box textAlign="center" padding={{ vertical: 'xl' }}>
                <StatusIndicator type="error">
                  {errorMessage || 'Generation failed'}
                </StatusIndicator>
              </Box>
              <Box textAlign="center">
                <Button variant="link" onClick={handleBackToSearch}>
                  Back to Search
                </Button>
              </Box>
            </SpaceBetween>
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSummary(execution: AdsExecution): GenerationSummary | null {
  const metadata = execution.output_metadata
  if (!metadata || typeof metadata !== 'object') {
    return null
  }
  // The orchestration-core uno_state_change_handler writes the full Step
  // Function output verbatim into output_metadata. The render Lambda's result
  // lands under builder_result.summary; older backfilled rows put the summary
  // at the top level. Try both, in priority order.
  const m = metadata as Record<string, unknown>
  const builderResult = m.builder_result as Record<string, unknown> | undefined
  const summary =
    (builderResult && typeof builderResult === 'object' ? builderResult.summary : undefined) ??
    m.summary
  if (!summary || typeof summary !== 'object') {
    return null
  }
  const s = summary as Record<string, unknown>
  return {
    slides_modified: numberFrom(s.slides_modified),
    total_replacements: numberFrom(s.total_replacements),
    tbd_count: numberFrom(s.tbd_count),
    unreplaced_count: numberFrom(s.unreplaced_count),
    tbd_tokens: stringArrayFrom(s.tbd_tokens),
    unreplaced: stringArrayFrom(s.unreplaced),
    app_acronym: typeof s.app_acronym === 'string' ? s.app_acronym : undefined,
    mots_id: typeof s.mots_id === 'string' ? s.mots_id : undefined,
  }
}

function numberFrom(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // The orchestration-core API serializes DynamoDB N-type values via Decimal,
  // which round-trips through JSON as a string. Accept numeric strings too.
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function stringArrayFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

// ---------------------------------------------------------------------------
// GenerationStepper — horizontal 5-step row mirroring the SF pipeline
// ---------------------------------------------------------------------------

interface GenerationStepperProps {
  // Name of the SF state currently executing (e.g. "SynthesizeLambda"), or
  // null when the API hasn't reported a state yet (between submit and the
  // first poll, or when GetExecutionHistory failed).
  currentSfState: string | null
}

function GenerationStepper({ currentSfState }: GenerationStepperProps) {
  const activeIndex = currentSfState
    ? GENERATION_STEPS.findIndex((s) => s.state === currentSfState)
    : -1

  return (
    <div
      role="list"
      aria-label="Generation progress"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        justifyContent: 'center',
        gap: '8px',
      }}
    >
      {GENERATION_STEPS.map((step, idx) => {
        const stepStatus = stepStatusFor(idx, activeIndex)
        const isLast = idx === GENERATION_STEPS.length - 1
        return (
          <div
            key={step.state}
            style={{ display: 'flex', alignItems: 'stretch', gap: '8px' }}
          >
            <StepperItem label={step.label} status={stepStatus} stepNumber={idx + 1} />
            {!isLast && <StepperArrow done={stepStatus === 'done'} />}
          </div>
        )
      })}
    </div>
  )
}

function stepStatusFor(stepIndex: number, activeIndex: number): StepStatus {
  if (activeIndex < 0) {
    // No state reported yet: treat the first step as in-progress so the user
    // sees the pipeline kicking off rather than a frozen pending row.
    return stepIndex === 0 ? 'in-progress' : 'pending'
  }
  if (stepIndex < activeIndex) return 'done'
  if (stepIndex === activeIndex) return 'in-progress'
  return 'pending'
}

interface StepperItemProps {
  label: string
  status: StepStatus
  stepNumber: number
}

function StepperItem({ label, status, stepNumber }: StepperItemProps) {
  return (
    <div
      role="listitem"
      aria-current={status === 'in-progress' ? 'step' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        textAlign: 'center',
        minWidth: '140px',
        maxWidth: '160px',
        padding: '12px 8px',
        borderRadius: '8px',
        border: `1px solid ${stepBorderColor(status)}`,
        background: stepBackground(status),
        opacity: status === 'pending' ? 0.55 : 1,
        transition: 'opacity 200ms ease, background 200ms ease, border-color 200ms ease',
      }}
    >
      <Box variant="small" color="text-body-secondary" padding={{ bottom: 'xxs' }}>
        Step {stepNumber}
      </Box>
      <Box padding={{ bottom: 'xs' }}>
        <StepIcon status={status} />
      </Box>
      <Box variant="small" fontWeight="bold">
        {label}
      </Box>
    </div>
  )
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'in-progress') return <Spinner size="normal" />
  if (status === 'done') return <StatusIndicator type="success">Done</StatusIndicator>
  if (status === 'error') return <StatusIndicator type="error">Failed</StatusIndicator>
  return <StatusIndicator type="pending">Pending</StatusIndicator>
}

function StepperArrow({ done }: { done: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: '20px',
        color: done ? '#037f0c' : '#8e9095',
        transition: 'color 200ms ease',
      }}
    >
      →
    </div>
  )
}

function stepBackground(status: StepStatus): string {
  switch (status) {
    case 'done':
      return '#f1f8f1'
    case 'in-progress':
      return '#f2f8fd'
    case 'error':
      return '#fdf3f1'
    default:
      return 'transparent'
  }
}

function stepBorderColor(status: StepStatus): string {
  switch (status) {
    case 'done':
      return '#037f0c'
    case 'in-progress':
      return '#0972d3'
    case 'error':
      return '#d91515'
    default:
      return '#d5d9e0'
  }
}
