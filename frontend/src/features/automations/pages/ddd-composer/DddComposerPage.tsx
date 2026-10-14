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
} from '@cloudscape-design/components'
import { dddComposerApi, DddExecution } from '../../services/dddComposer'
import { extractApiError } from '../../utils/extractApiError'

const POLL_INTERVAL_MS = 3500

type ViewState = 'search' | 'generate' | 'generating' | 'done' | 'failed'

export default function DddComposerPage() {
  // Core state
  const [view, setView] = useState<ViewState>('search')
  const [itapId, setItapId] = useState('')
  const [executions, setExecutions] = useState<DddExecution[]>([])
  const [currentExecutionId, setCurrentExecutionId] = useState('')

  // File state
  const [waveUtilFile, setWaveUtilFile] = useState<File | null>(null)
  const [interfaceTrackingFile, setInterfaceTrackingFile] = useState<File | null>(null)
  const [csvFiles, setCsvFiles] = useState<File[]>([])

  // UI state
  const [searchLoading, setSearchLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [downloadLoading, setDownloadLoading] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // File input refs for resetting
  const waveUtilRef = useRef<HTMLInputElement | null>(null)
  const interfaceTrackingRef = useRef<HTMLInputElement | null>(null)
  const csvFilesRef = useRef<HTMLInputElement | null>(null)

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    // Clear any existing interval
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    const hasRunning = executions.some((e) => e.status === 'RUNNING' || e.status === 'PENDING')

    if (view === 'search' && hasRunning && itapId) {
      pollingRef.current = setInterval(async () => {
        try {
          const { data } = await dddComposerApi.listExecutions(itapId)
          setExecutions(data.executions ?? [])
        } catch {
          // Silently ignore polling errors in search view
        }
      }, POLL_INTERVAL_MS)
    } else if (view === 'generating' && currentExecutionId) {
      pollingRef.current = setInterval(async () => {
        try {
          const { data } = await dddComposerApi.getExecutionStatus(currentExecutionId)
          if (data.status === 'COMPLETED') {
            setView('done')
          } else if (data.status === 'FAILED') {
            setErrorMessage(data.error_message ?? 'Generation failed')
            setView('failed')
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
      const { data } = await dddComposerApi.listExecutions(itapId.trim())
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
    if (!waveUtilFile) errors.waveUtil = 'Wave Utilization Excel file is required'
    if (!interfaceTrackingFile) errors.interfaceTracking = 'Interface Tracking Excel file is required'

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors)
      return
    }

    setValidationErrors({})
    setErrorMessage('')
    setGenerateLoading(true)
    try {
      const files = [waveUtilFile!, interfaceTrackingFile!, ...csvFiles]
      const { data } = await dddComposerApi.startGeneration(itapId.trim(), files)
      setCurrentExecutionId(data.execution_id)
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
      const response = await dddComposerApi.downloadDocument(executionId)
      const disposition = response.headers['content-disposition']
      const filename = disposition
        ? disposition.split('filename=')[1]?.replace(/"/g, '')
        : 'ddd-document.docx'
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = filename || 'ddd-document.docx'
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
    setErrorMessage('')
    setWaveUtilFile(null)
    setInterfaceTrackingFile(null)
    setCsvFiles([])
    if (waveUtilRef.current) waveUtilRef.current.value = ''
    if (interfaceTrackingRef.current) interfaceTrackingRef.current.value = ''
    if (csvFilesRef.current) csvFilesRef.current.value = ''
  }

  // ---------------------------------------------------------------------------
  // Table column definitions
  // ---------------------------------------------------------------------------

  const columnDefinitions = [
    {
      id: 'datetime',
      header: 'Date/Time',
      cell: (item: DddExecution) =>
        item.created_at ? new Date(item.created_at).toLocaleString() : '—',
      sortingField: 'created_at',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (item: DddExecution) => {
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
      cell: (item: DddExecution) =>
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
    <ContentLayout header={<Header variant="h1">DDD Composer</Header>}>
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
                  + Generate DDD
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
          <Container header={<Header variant="h2">Generate DDD Document</Header>}>
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
              <FormField label="Wave Utilization Excel" errorText={validationErrors.waveUtil}>
                <input
                  ref={waveUtilRef}
                  type="file"
                  accept=".xlsx"
                  onChange={(e) => {
                    setWaveUtilFile(e.target.files?.[0] ?? null)
                    setValidationErrors((prev) => ({ ...prev, waveUtil: '' }))
                  }}
                />
              </FormField>
              <FormField label="Interface Tracking Excel" errorText={validationErrors.interfaceTracking}>
                <input
                  ref={interfaceTrackingRef}
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(e) => {
                    setInterfaceTrackingFile(e.target.files?.[0] ?? null)
                    setValidationErrors((prev) => ({ ...prev, interfaceTracking: '' }))
                  }}
                />
              </FormField>
              <FormField
                label="Snowflake Data Files (CSV)"
                description="Optional — upload CSV exports for testing without Snowflake connectivity. Multiple files allowed."
              >
                <input
                  ref={csvFilesRef}
                  type="file"
                  accept=".csv"
                  multiple
                  onChange={(e) => setCsvFiles(Array.from(e.target.files ?? []))}
                />
              </FormField>
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="primary" onClick={handleGenerate} loading={generateLoading}>
                  Generate DDD
                </Button>
                <Button variant="link" onClick={handleBackToSearch}>
                  Back to Search
                </Button>
              </SpaceBetween>
            </SpaceBetween>
          </Container>
        )}

        {view === 'generating' && (
          <Container header={<Header variant="h2">Generating DDD Document</Header>}>
            <SpaceBetween size="l">
              <Box textAlign="center" padding={{ vertical: 'xl' }}>
                <StatusIndicator type="in-progress">
                  Generating DDD document...
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

        {view === 'done' && (
          <Container header={<Header variant="h2">Generation Complete</Header>}>
            <SpaceBetween size="l">
              <Box textAlign="center" padding={{ vertical: 'xl' }}>
                <SpaceBetween size="m" direction="vertical" alignItems="center">
                  <StatusIndicator type="success">
                    DDD document generated successfully
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
