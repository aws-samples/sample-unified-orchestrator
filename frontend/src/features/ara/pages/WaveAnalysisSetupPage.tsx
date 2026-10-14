import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ContentLayout,
  Container,
  Header,
  SpaceBetween,
  Box,
  Button,
  Select,
  Alert,
  SelectProps,
  ColumnLayout,
  Table,
  Spinner,
  Badge,
  ExpandableSection,
} from '@cloudscape-design/components'
import { runWavePatternAnalysis, getWavePatternAnalysis } from '../services/patterns'
import apiClient from '../../uno/services/api'


interface Application {
  application_id: string
  APPLICATION_NAME?: string
  application_name?: string
  risk_assessment_status?: string
  wave_analysis_status?: string
  atx_mapping_status?: string
  atx_id?: string
}

export default function WaveAnalysisSetupPage() {
  const navigate = useNavigate()

  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [selectedWave, setSelectedWave] = useState<SelectProps.Option | null>(null)
  const [eligibleApps, setEligibleApps] = useState<Application[]>([])
  const [atxMappedApps, setAtxMappedApps] = useState<Application[]>([])
  const [latestPatterns, setLatestPatterns] = useState<any[]>([])
  const [latestSummary, setLatestSummary] = useState<any>(null)
  const [loadingLatest, setLoadingLatest] = useState(false)
  const [similarityThreshold, setSimilarityThreshold] = useState<SelectProps.Option>({
    label: '70%',
    value: '70',
  })

  useEffect(() => {
    if (selectedWave) {
      loadEligibleApplications(selectedWave.value!)
    } else {
      setEligibleApps([])
      setAtxMappedApps([])
    }
  }, [selectedWave])

  const waveOptions = [
    { label: 'Wave 0', value: 'wave0' },
    { label: 'Wave 1', value: 'wave1' },
    { label: 'Wave 2', value: 'wave2' },
  ]

  const thresholdOptions = [
    { label: '50%', value: '50' },
    { label: '60%', value: '60' },
    { label: '70%', value: '70' },
    { label: '80%', value: '80' },
    { label: '90%', value: '90' },
  ]

  const loadLatestAnalysis = async (waveId: string) => {
    setLoadingLatest(true)
    setLatestPatterns([])
    setLatestSummary(null)
    try {
      const response = await getWavePatternAnalysis(waveId)
      if (response.success || response.executive_summary) {
        setLatestSummary(response.executive_summary || null)
        setLatestPatterns(response.patterns || [])
      }
    } catch { /* no previous analysis — that's fine */ }
    setLoadingLatest(false)
  }

  const loadEligibleApplications = async (waveId: string) => {
    setLoading(true)
    setError(null)
    loadLatestAnalysis(waveId)
    try {
      // Get all applications in the wave
      const response = await apiClient.get(`/wave/applications/paginated`, {
        params: {
          wave: waveId,  // Backend expects 'wave' not 'wave_id'
          page: 1,
          page_size: 1000, // Get all applications
        },
      })

      if (response.data.success) {
        const allApps = response.data.applications || []

        // Filter for eligible applications (risk assessment IN_PROGRESS or COMPLETED, wave analysis not completed)
        const eligible = allApps.filter((app: Application) => {
          const riskStatus = app.risk_assessment_status
          return (
            (riskStatus === 'IN_PROGRESS' || riskStatus === 'COMPLETED') &&
            app.wave_analysis_status !== 'COMPLETED' &&
            app.atx_mapping_status !== 'COMPLETED'
          )
        })

        setEligibleApps(eligible)
      }

      // Get applications with ATX mappings from wave_patterns table (non-blocking)
      try {
        const atxResponse = await apiClient.get(`/ara/patterns/wave/${waveId}/atx-mappings`)
        if (atxResponse.data.success) {
          const mappings = atxResponse.data.mappings || []
          const atxApps = mappings.map((mapping: any) => ({
            application_id: mapping.application_id,
            APPLICATION_NAME: mapping.application_name,
            atx_id: mapping.atx_name,
            atx_mapping_status: 'MAPPED',
          }))
          setAtxMappedApps(atxApps)
        }
      } catch { /* ATX mappings are optional */ }
    } catch (err: any) {
      console.error('Error loading eligible applications:', err)
      setError('Failed to load applications for this wave')
    } finally {
      setLoading(false)
    }
  }

  const handleRunAnalysis = async () => {
    if (!selectedWave) return

    setRunning(true)
    setError(null)
    setInfoMessage(null)

    try {
      const threshold = parseInt(similarityThreshold.value || '70')
      const response = await runWavePatternAnalysis(selectedWave.value!, threshold)

      if (response.success) {
        // Check if no applications were analyzed
        if (response.analyzed_count === 0) {
          // Show informational message about exclusions
          const exclusionMessages = []
          const reasons = response.exclusion_reasons || {}

          if (reasons.risk_not_started && reasons.risk_not_started > 0) {
            exclusionMessages.push(
              `${reasons.risk_not_started} without risk assessment started`
            )
          }
          if (reasons.wave_already_completed && reasons.wave_already_completed > 0) {
            exclusionMessages.push(`${reasons.wave_already_completed} already analyzed`)
          }
          if (reasons.atx_already_completed && reasons.atx_already_completed > 0) {
            exclusionMessages.push(
              `${reasons.atx_already_completed} with completed ATX mapping`
            )
          }

          let message = `No applications eligible for wave analysis.\n\nTotal applications in wave: ${response.total_applications || 0
            }\nAnalyzed: 0\nExcluded: ${response.excluded_count || 0}`

          if (exclusionMessages.length > 0) {
            message += `\n\nExclusion reasons:\n• ${exclusionMessages.join('\n• ')}`
          }

          setInfoMessage(message)
        } else {
          // Navigate to results page
          navigate(`/patterns/results/${selectedWave.value}`)
        }
      } else {
        setError(response.error || 'Failed to run analysis')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to run analysis')
    } finally {
      setRunning(false)
    }
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Run pattern analysis to identify migration patterns across applications in a wave"
        >
          Application Pattern Analysis
        </Header>
      }
    >
      <SpaceBetween size="l">
        {/* Error Alert */}
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Info Message Alert */}
        {infoMessage && (
          <Alert
            type="info"
            dismissible
            onDismiss={() => setInfoMessage(null)}
            header="Wave Analysis Result"
          >
            <div style={{ whiteSpace: 'pre-line' }}>{infoMessage}</div>
          </Alert>
        )}

        {/* Setup Form */}
        <Container header={<Header variant="h2">Analysis Configuration</Header>}>
          <SpaceBetween size="l">
            <ColumnLayout columns={2}>
              <div>
                <Box variant="awsui-key-label" margin={{ bottom: 'xxxs' }}>
                  Wave Selection
                </Box>
                <Select
                  selectedOption={selectedWave}
                  onChange={({ detail }) => setSelectedWave(detail.selectedOption)}
                  options={waveOptions}
                  placeholder="Select a wave to analyze"
                  selectedAriaLabel="Selected"
                />
              </div>
              <div>
                <Box variant="awsui-key-label" margin={{ bottom: 'xxxs' }}>
                  Similarity Threshold
                </Box>
                <Select
                  selectedOption={similarityThreshold}
                  onChange={({ detail }) =>
                    setSimilarityThreshold(detail.selectedOption)
                  }
                  options={thresholdOptions}
                  selectedAriaLabel="Selected"
                />
                <Box variant="small" color="text-body-secondary" margin={{ top: 'xxxs' }}>
                  Applications with similar patterns above this threshold will be grouped
                  together
                </Box>
              </div>
            </ColumnLayout>

            <Box textAlign="center" padding={{ top: 'm' }}>
              <Button
                variant="primary"
                onClick={handleRunAnalysis}
                disabled={!selectedWave || running || eligibleApps.length === 0}
                loading={running}
                iconName="search"
              >
                Run Analysis
              </Button>
            </Box>
          </SpaceBetween>
        </Container>

        {/* Latest Analysis Results */}
        {selectedWave && latestSummary && (
          <Container header={
            <Header variant="h2" description={`Last analyzed: ${latestSummary.analysis_timestamp ? new Date(latestSummary.analysis_timestamp).toLocaleString() : 'Unknown'}`}
              actions={<Button variant="link" onClick={() => navigate(`/patterns/results/${selectedWave.value}`)}>View Full Results</Button>}>
              Latest Analysis — {selectedWave.label}
            </Header>
          }>
            <SpaceBetween size="m">
              <ColumnLayout columns={4} variant="text-grid">
                <div><Box variant="awsui-key-label">Total Applications</Box><Box variant="awsui-value-large">{latestSummary.total_applications}</Box></div>
                <div><Box variant="awsui-key-label">Patterns Identified</Box><Box variant="awsui-value-large">{latestSummary.unique_patterns}</Box></div>
                <div><Box variant="awsui-key-label">No Migration Needed</Box><Box variant="awsui-value-large">{latestSummary.applications_no_migration_needed}</Box></div>
                <div><Box variant="awsui-key-label">Assessment Required</Box><Box variant="awsui-value-large">{latestSummary.applications_without_patterns}</Box></div>
              </ColumnLayout>

              {latestPatterns.length > 0 && (
                <SpaceBetween size="xs">
                  {latestPatterns.map(p => (
                    <ExpandableSection key={p.pattern_id} defaultExpanded={false}
                      headerText={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Badge color={p.pattern_state === 'HAS_CHANGES' ? 'blue' : p.pattern_state === 'NO_CHANGES_NEEDED' ? 'green' : p.pattern_state === 'NO_TARGET_VERSIONS' ? 'red' : 'grey'}>
                            {p.pattern_state === 'HAS_CHANGES' ? 'Has Changes' : p.pattern_state === 'NO_CHANGES_NEEDED' ? 'No Changes' : p.pattern_state === 'NO_TARGET_VERSIONS' ? 'Assessment Required' : p.pattern_state}
                          </Badge>
                          <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>{p.pattern_id}</span>
                          {p.human_name && <span style={{ color: '#5f6b7a' }}>— {p.human_name}</span>}
                          <Badge>{p.migration_strategy || 'Unknown'}</Badge>
                          <span style={{ color: '#5f6b7a' }}>({p.application_count} app{p.application_count !== 1 ? 's' : ''})</span>
                        </span>
                      }>
                      <Table
                        columnDefinitions={[
                          { id: 'app_id', header: 'App ID', cell: (item: any) => <Box variant="code">{item.app_id}</Box>, width: 100 },
                          { id: 'app_name', header: 'Application', cell: (item: any) => <Box fontWeight="bold">{item.app_name}</Box> },
                          { id: 'changes', header: 'Changes', cell: (item: any) => item.change_count > 0 ? <Box color="text-status-warning">{item.change_count} upgrade{item.change_count !== 1 ? 's' : ''}</Box> : <Box color="text-body-secondary">None</Box>, width: 100 },
                        ]}
                        items={p.applications || []}
                        variant="embedded" stripedRows sortingDisabled wrapLines={false}
                      />
                    </ExpandableSection>
                  ))}
                </SpaceBetween>
              )}
            </SpaceBetween>
          </Container>
        )}
        {selectedWave && loadingLatest && (
          <Container><Box textAlign="center" padding="l"><Spinner /> Loading latest analysis...</Box></Container>
        )}

        {/* Eligible Applications List */}
        {selectedWave && (
          <Container
            header={
              <Header
                variant="h2"
                counter={loading ? '' : `(${eligibleApps.length})`}
                description="Applications with completed risk assessment that are eligible for application pattern analysis"
              >
                Eligible Applications
              </Header>
            }
          >
            {loading ? (
              <Box textAlign="center" padding="l">
                <Spinner size="large" />
                <Box variant="p" padding={{ top: 's' }}>
                  Loading applications...
                </Box>
              </Box>
            ) : eligibleApps.length === 0 ? (
              <Box textAlign="center" padding="l">
                <Box variant="h3" color="text-status-inactive">
                  No eligible applications
                </Box>
                <Box variant="p" color="text-body-secondary" padding={{ top: 's' }}>
                  Applications must have completed risk assessment to be eligible for wave
                  pattern analysis.
                </Box>
              </Box>
            ) : (
              <Table
                columnDefinitions={[
                  {
                    id: 'application_id',
                    header: 'Application ID',
                    cell: (item) => (
                      <Box variant="code" fontSize="body-s">
                        {item.application_id}
                      </Box>
                    ),
                    width: 150,
                  },
                  {
                    id: 'application_name',
                    header: 'Application Name',
                    cell: (item) => (
                      <Box fontWeight="bold">{item.APPLICATION_NAME || item.application_name || 'N/A'}</Box>
                    ),
                  },
                  {
                    id: 'risk_status',
                    header: 'Risk Assessment',
                    cell: (item) => (
                      <Box color="text-status-success">
                        ✓ {item.risk_assessment_status}
                      </Box>
                    ),
                    width: 180,
                  },
                ]}
                items={eligibleApps}
                loadingText="Loading applications"
                empty={
                  <Box textAlign="center" color="inherit">
                    <b>No eligible applications</b>
                  </Box>
                }
                variant="embedded"
              />
            )}
          </Container>
        )}

        {/* ATX Mapped Applications List */}
        {selectedWave && atxMappedApps.length > 0 && (
          <Container
            header={
              <Header
                variant="h2"
                counter={`(${atxMappedApps.length})`}
                description="Applications that already have ATX mapping assigned"
              >
                Applications with ATX Mapped
              </Header>
            }
          >
            <Table
              columnDefinitions={[
                {
                  id: 'application_id',
                  header: 'Application ID',
                  cell: (item) => (
                    <Box variant="code" fontSize="body-s">
                      {item.application_id}
                    </Box>
                  ),
                  width: 150,
                },
                {
                  id: 'application_name',
                  header: 'Application Name',
                  cell: (item) => (
                    <Box fontWeight="bold">{item.APPLICATION_NAME || item.application_name || 'N/A'}</Box>
                  ),
                },
                {
                  id: 'atx_id',
                  header: 'ATX Pattern',
                  cell: (item) => (
                    <Box color="text-status-info" fontWeight="bold">
                      {item.atx_id || 'N/A'}
                    </Box>
                  ),
                  width: 250,
                },
                {
                  id: 'atx_status',
                  header: 'Status',
                  cell: (item) => (
                    <Box color="text-status-success">
                      ✓ {item.atx_mapping_status}
                    </Box>
                  ),
                  width: 120,
                },
              ]}
              items={atxMappedApps}
              loadingText="Loading applications"
              empty={
                <Box textAlign="center" color="inherit">
                  <b>No applications with ATX mapped</b>
                </Box>
              }
              variant="embedded"
            />
          </Container>
        )}

        {/* Info Box */}
        <Container>
          <SpaceBetween size="m">
            <Box variant="h3">What does this analysis do?</Box>
            <Box variant="p">
              Application Pattern Analysis examines all applications in a wave and identifies common
              migration patterns based on component version changes. Applications with similar
              transformation requirements are grouped together to streamline migration planning.
            </Box>
            <Box variant="h3">Prerequisites</Box>
            <Box variant="p">
              Applications must have completed risk assessment before they can be included in
              application pattern analysis.
            </Box>
          </SpaceBetween>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  )
}
