import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ContentLayout,
  Container,
  Header,
  SpaceBetween,
  Table,
  Box,
  Badge,
  Button,
  Select,
  Alert,
  Spinner,
  ColumnLayout,
  Input,
  SelectProps,
  BreadcrumbGroup,
  ExpandableSection,
} from '@cloudscape-design/components'
import { getWavePatternAnalysis } from '../services/patterns'

interface Pattern {
  pattern_id: string
  pattern_state: string
  human_name: string
  description?: string
  pattern_signature: string
  migration_strategy: string
  application_count: number
  applications: Array<{
    app_id: string
    app_name: string
    description?: string
    change_count: number
    total_components: number
    pattern_reused?: boolean
    matched_from_app?: string
    atx_name?: string
    atx_mapped?: boolean
    atx_mapping_status?: string
  }>
}

interface ExecutiveSummary {
  wave_id: string
  total_applications: number
  unique_patterns: number
  applications_with_patterns: number
  applications_without_patterns: number
  applications_no_migration_needed: number
  analysis_timestamp: string
}

export default function WaveAnalysisResultsPage() {
  const { waveId } = useParams<{ waveId: string }>()
  const navigate = useNavigate()

  // Get analysisId from URL query parameters for historical views
  const searchParams = new URLSearchParams(window.location.search)
  const analysisId = searchParams.get('analysisId')
  const isHistoricalView = !!analysisId

  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummary | null>(null)
  const [recommendations, setRecommendations] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')

  const [selectedPatternState, setSelectedPatternState] = useState<SelectProps.Option | null>(null)
  const [selectedMigrationStrategy, setSelectedMigrationStrategy] = useState<SelectProps.Option | null>(null)
  const [, setCurrentPage] = useState(1)

  useEffect(() => {
    if (waveId) {
      loadAnalysis(waveId, analysisId || undefined)
      // Reset to page 1 when loading new analysis
      setCurrentPage(1)
    }
  }, [waveId, analysisId])

  const patternStateOptions = [
    { label: 'All States', value: '' },
    { label: 'Has Changes', value: 'HAS_CHANGES' },
    { label: 'No Changes Needed', value: 'NO_CHANGES_NEEDED' },
    { label: 'Assessment Required', value: 'NO_TARGET_VERSIONS' },
  ]

  const loadAnalysis = async (waveId: string, analysisId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await getWavePatternAnalysis(waveId, analysisId)
      if (response.success || response.executive_summary) {
        setExecutiveSummary(response.executive_summary || null)
        setPatterns(response.patterns || [])
        setRecommendations(response.recommendations || [])
      } else {
        setError(response.error || 'No analysis found for this wave')
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setError('No analysis found for this wave. Please run an analysis first.')
      } else {
        setError(err.message || 'Failed to load analysis')
      }
    } finally {
      setLoading(false)
    }
  }

  const getWaveLabel = (waveId: string) => {
    const waveMap: Record<string, string> = {
      wave0: 'Wave 0',
      wave1: 'Wave 1',
      wave2: 'Wave 2',
    }
    return waveMap[waveId] || waveId
  }

  // Flatten patterns to application-wise view
  const applicationsList = patterns.flatMap((pattern) =>
    pattern.applications.map((app) => ({
      ...app,
      pattern_id: pattern.pattern_id,
      pattern_state: pattern.pattern_state,
      pattern_description: pattern.description,
      migration_strategy: pattern.migration_strategy,
      human_name: pattern.human_name,
    }))
  )

  // Filter applications
  const filteredApplications = applicationsList.filter((app) => {
    if (selectedPatternState && selectedPatternState.value) {
      if (app.pattern_state !== selectedPatternState.value) {
        return false
      }
    }

    if (selectedMigrationStrategy && selectedMigrationStrategy.value) {
      if (app.migration_strategy !== selectedMigrationStrategy.value) {
        return false
      }
    }

    if (!searchText) return true
    const search = searchText.toLowerCase()
    return (
      app.app_id.toLowerCase().includes(search) ||
      app.app_name.toLowerCase().includes(search) ||
      (app.description && app.description.toLowerCase().includes(search)) ||
      (app.pattern_description && app.pattern_description.toLowerCase().includes(search)) ||
      app.pattern_id.toLowerCase().includes(search)
    )
  })

  // Sort applications
  const sortedApplications = [...filteredApplications].sort((a, b) => {
    const stateOrder = {
      NO_TARGET_VERSIONS: 0,
      HAS_CHANGES: 1,
      NO_CHANGES_NEEDED: 2,
      ERROR: 3,
    }
    const stateCompare =
      (stateOrder[a.pattern_state as keyof typeof stateOrder] || 999) -
      (stateOrder[b.pattern_state as keyof typeof stateOrder] || 999)
    if (stateCompare !== 0) return stateCompare

    if (a.pattern_id < b.pattern_id) return -1
    if (a.pattern_id > b.pattern_id) return 1

    return a.app_id.localeCompare(b.app_id)
  })

  const migrationStrategies = Array.from(new Set(patterns.map((p) => p.migration_strategy)))
    .filter((s) => s && s !== 'Unknown')
    .sort()

  const getPatternStateColor = (state: string): 'red' | 'blue' | 'green' | 'grey' => {
    switch (state) {
      case 'NO_TARGET_VERSIONS':
        return 'red'
      case 'HAS_CHANGES':
        return 'blue'
      case 'NO_CHANGES_NEEDED':
        return 'green'
      default:
        return 'grey'
    }
  }

  const getPatternStateLabel = (state: string): string => {
    switch (state) {
      case 'NO_TARGET_VERSIONS':
        return 'Assessment Required'
      case 'HAS_CHANGES':
        return 'Has Changes'
      case 'NO_CHANGES_NEEDED':
        return 'No Changes'
      default:
        return state
    }
  }

  return (
    <>
      <ContentLayout
        header={
          <SpaceBetween size="m">
            <BreadcrumbGroup
              items={[
                { text: 'Application Pattern Analysis', href: '/patterns' },
                { text: getWaveLabel(waveId || ''), href: '#' },
              ]}
              onFollow={(e) => {
                e.preventDefault()
                if (e.detail.href === '/patterns') {
                  navigate('/patterns')
                }
              }}
            />
            <Header
              variant="h1"
              description={
                isHistoricalView
                  ? `Historical pattern analysis for ${getWaveLabel(waveId || '')} (Analysis ID: ${analysisId})`
                  : `Pattern analysis results for ${getWaveLabel(waveId || '')}`
              }
              actions={
                !isHistoricalView && (
                  <Button
                    variant="primary"
                    onClick={() => navigate('/patterns')}
                    iconName="refresh"
                  >
                    Run New Analysis
                  </Button>
                )
              }
            >
              {getWaveLabel(waveId || '')} - {isHistoricalView ? 'Historical ' : ''}Analysis Results
            </Header>
          </SpaceBetween>
        }
      >
        <SpaceBetween size="l">
          {error && (
            <Alert
              type="error"
              dismissible
              onDismiss={() => setError(null)}
              action={
                <Button onClick={() => navigate('/patterns')}>Run New Analysis</Button>
              }
            >
              {error}
            </Alert>
          )}

          {loading && (
            <Container>
              <Box textAlign="center" padding="xxl">
                <Spinner size="large" />
                <Box variant="p" padding={{ top: 's' }}>
                  Loading pattern analysis...
                </Box>
              </Box>
            </Container>
          )}

          {!loading && executiveSummary && patterns.length > 0 && (
            <SpaceBetween size="l">
              {/* Executive Summary */}
              <Container header={<Header variant="h2">Executive Summary</Header>}>
                <ColumnLayout columns={4} variant="text-grid">
                  <div>
                    <Box variant="awsui-key-label">Total Applications</Box>
                    <Box variant="awsui-value-large">
                      {executiveSummary.total_applications}
                    </Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Patterns Identified</Box>
                    <Box variant="awsui-value-large">
                      {executiveSummary.unique_patterns}
                    </Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">No Migration Needed</Box>
                    <Box variant="awsui-value-large">
                      {executiveSummary.applications_no_migration_needed}
                    </Box>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Assessment Required</Box>
                    <Box variant="awsui-value-large">
                      {executiveSummary.applications_without_patterns}
                    </Box>
                  </div>
                </ColumnLayout>
              </Container>

              {/* Recommendations */}
              {recommendations.length > 0 && (
                <Alert type="info" header="Recommendations">
                  <ul style={{ marginLeft: '20px', marginBottom: 0 }}>
                    {recommendations.map((rec, idx) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {/* Filters */}
              <Container>
                <SpaceBetween size="m">
                  <ColumnLayout columns={3}>
                    <Select
                      selectedOption={selectedPatternState}
                      onChange={({ detail }) => {
                        setSelectedPatternState(detail.selectedOption)
                        setCurrentPage(1)
                      }}
                      options={patternStateOptions}
                      placeholder="Filter by state"
                      selectedAriaLabel="Selected"
                    />
                    <Select
                      selectedOption={selectedMigrationStrategy}
                      onChange={({ detail }) => {
                        setSelectedMigrationStrategy(detail.selectedOption)
                        setCurrentPage(1)
                      }}
                      options={[
                        { label: 'All Strategies', value: '' },
                        ...migrationStrategies.map((s) => ({ label: s, value: s })),
                      ]}
                      placeholder="Filter by strategy"
                      selectedAriaLabel="Selected"
                    />
                    <Input
                      placeholder="Search applications or patterns..."
                      value={searchText}
                      onChange={({ detail }) => {
                        setSearchText(detail.value)
                        setCurrentPage(1)
                      }}
                      type="search"
                    />
                  </ColumnLayout>
                </SpaceBetween>
              </Container>

              {/* Patterns grouped with expandable sections */}
              {(() => {
                // Group filtered apps back into patterns
                const patternGroups: Record<string, { pattern_id: string; pattern_state: string; human_name: string; migration_strategy: string; apps: typeof sortedApplications }> = {}
                sortedApplications.forEach(app => {
                  if (!patternGroups[app.pattern_id]) {
                    patternGroups[app.pattern_id] = {
                      pattern_id: app.pattern_id,
                      pattern_state: app.pattern_state,
                      human_name: app.human_name,
                      migration_strategy: app.migration_strategy,
                      apps: [],
                    }
                  }
                  patternGroups[app.pattern_id].apps.push(app)
                })
                const groups = Object.values(patternGroups)

                if (!groups.length) return (
                  <Container><Box textAlign="center" padding="l" color="text-body-secondary">No patterns match the current filters.</Box></Container>
                )

                return (
                  <Container header={
                    <Header variant="h2" counter={`(${groups.length} patterns, ${sortedApplications.length} applications)`}
                      actions={<Button onClick={() => { setSearchText(''); setSelectedPatternState(null); setSelectedMigrationStrategy(null); setCurrentPage(1) }}>Clear Filters</Button>}>
                      Migration Patterns
                    </Header>
                  }>
                    <SpaceBetween size="s">
                      {groups.map(group => (
                        <ExpandableSection key={group.pattern_id} defaultExpanded={groups.length <= 5}
                          headerText={
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <Badge color={getPatternStateColor(group.pattern_state)}>{getPatternStateLabel(group.pattern_state)}</Badge>
                              <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>{group.pattern_id}</span>
                              {group.human_name && <span style={{ color: '#5f6b7a' }}>— {group.human_name}</span>}
                              <Badge>{group.migration_strategy || 'Unknown'}</Badge>
                              <span style={{ color: '#5f6b7a' }}>({group.apps.length} app{group.apps.length !== 1 ? 's' : ''})</span>
                            </span>
                          }
                          variant="container">
                          <Table
                            columnDefinitions={[
                              { id: 'app_id', header: 'App ID', cell: (item: any) => <Box variant="code" fontWeight="bold">{item.app_id}</Box>, width: 100 },
                              { id: 'app_name', header: 'Application', cell: (item: any) => (
                                <SpaceBetween size="xxs">
                                  <Box fontWeight="bold">{item.app_name}</Box>
                                  {item.pattern_reused && <Box variant="small" color="text-status-success">♻️ Reused from {item.matched_from_app}</Box>}
                                </SpaceBetween>
                              )},
                              { id: 'changes', header: 'Changes', cell: (item: any) => item.change_count > 0
                                ? <Box color="text-status-warning">{item.change_count} upgrade{item.change_count !== 1 ? 's' : ''}</Box>
                                : <Box color="text-body-secondary">None</Box>, width: 100 },
                              { id: 'components', header: 'Components', cell: (item: any) => item.total_components || '-', width: 100 },
                            ]}
                            items={group.apps}
                            variant="embedded"
                            stripedRows
                            sortingDisabled
                            wrapLines={false}
                            empty={<Box textAlign="center">No applications</Box>}
                          />
                        </ExpandableSection>
                      ))}
                    </SpaceBetween>
                  </Container>
                )
              })()}
            </SpaceBetween>
          )}
        </SpaceBetween>
      </ContentLayout>

    </>
  )
}
