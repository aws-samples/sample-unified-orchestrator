// Placeholder for PatternDiscovery component
import { useState } from 'react'
import {
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
  Tabs,
} from '@cloudscape-design/components'
import { getWavePatternAnalysis, Pattern } from '../../services/patterns'
import ATXMappingPanel from './ATXMappingPanel'

export default function PatternDiscovery() {
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedWave, setSelectedWave] = useState<{ label: string; value: string } | null>(null)
  const [selectedPattern, setSelectedPattern] = useState<Pattern | null>(null)
  const [activeTabId, setActiveTabId] = useState('patterns')

  // Mock wave options - TODO: Replace with actual wave data
  const waveOptions = [
    { label: 'Wave 1 - Q1 2026', value: 'wave-1' },
    { label: 'Wave 2 - Q2 2026', value: 'wave-2' },
    { label: 'Wave 3 - Q3 2026', value: 'wave-3' },
  ]

  const loadPatterns = async (waveId: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await getWavePatternAnalysis(waveId)
      if (response.success && response.patterns) {
        setPatterns(response.patterns)
      } else {
        setError(response.error || 'Failed to load patterns')
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred while loading patterns')
    } finally {
      setLoading(false)
    }
  }

  const handleWaveChange = (option: { label?: string; value?: string } | null) => {
    setSelectedWave(option as { label: string; value: string } | null)
    setSelectedPattern(null)
    setActiveTabId('patterns') // Reset to patterns tab
    if (option?.value) {
      loadPatterns(option.value)
    } else {
      setPatterns([])
    }
  }

  const handleMappingsSubmitted = () => {
    // Optionally reload patterns or show success message
    if (selectedWave?.value) {
      loadPatterns(selectedWave.value)
    }
  }

  const getStateColor = (state: string) => {
    switch (state) {
      case 'HAS_CHANGES': return 'blue'
      case 'NO_CHANGES_NEEDED': return 'green'
      case 'NO_TARGET_VERSIONS': return 'grey'
      default: return 'blue'
    }
  }

  const tableColumns = [
    {
      id: 'human_name',
      header: 'Pattern Name',
      cell: (item: Pattern) => item.human_name,
      sortingField: 'human_name',
    },
    {
      id: 'pattern_state',
      header: 'State',
      cell: (item: Pattern) => (
        <Badge color={getStateColor(item.pattern_state)}>
          {item.pattern_state.replace(/_/g, ' ')}
        </Badge>
      ),
      sortingField: 'pattern_state',
    },
    {
      id: 'application_count',
      header: 'Applications',
      cell: (item: Pattern) => item.application_count,
      sortingField: 'application_count',
    },
    {
      id: 'migration_strategy',
      header: 'Strategy',
      cell: (item: Pattern) => item.migration_strategy,
      sortingField: 'migration_strategy',
    },
  ]

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h1"
            description="Discover and analyze transformation patterns across your migration waves"
          >
            Application Pattern Analysis
          </Header>
        }
      >
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <div>
              <Box variant="awsui-key-label">Select Wave</Box>
              <Select
                selectedOption={selectedWave}
                onChange={({ detail }) => handleWaveChange(detail.selectedOption)}
                options={waveOptions}
                placeholder="Choose a wave to analyze"
                disabled={loading}
              />
            </div>
            <div>
              <Box variant="awsui-key-label">Pattern Count</Box>
              <Box variant="p" fontSize="heading-xl">
                {patterns.length}
              </Box>
            </div>
          </ColumnLayout>

          {error && (
            <Alert type="error" dismissible onDismiss={() => setError(null)}>
              {error}
            </Alert>
          )}

          {loading && (
            <Box textAlign="center" padding="xxl">
              <Spinner size="large" />
              <Box variant="p" padding={{ top: 's' }}>
                Analyzing patterns...
              </Box>
            </Box>
          )}

          {!loading && !error && patterns.length === 0 && selectedWave && (
            <Alert type="info">
              No patterns detected for this wave. This could mean:
              <ul>
                <li>The wave has no applications assigned</li>
                <li>Applications don't have sufficient metadata for pattern detection</li>
                <li>No common transformation patterns were found</li>
              </ul>
            </Alert>
          )}
        </SpaceBetween>
      </Container>

      {!loading && patterns.length > 0 && (
        <Tabs
          activeTabId={activeTabId}
          onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
          tabs={[
            {
              id: 'patterns',
              label: 'Patterns',
              content: (
                <SpaceBetween size="l">
                  <Container>
                    <Table
                      columnDefinitions={tableColumns}
                      items={patterns}
                      loadingText="Loading patterns"
                      sortingDisabled={false}
                      empty={
                        <Box textAlign="center" color="inherit">
                          <b>No patterns</b>
                          <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                            No patterns to display.
                          </Box>
                        </Box>
                      }
                      header={
                        <Header
                          counter={`(${patterns.length})`}
                          actions={
                            <Button
                              iconName="refresh"
                              onClick={() => selectedWave && loadPatterns(selectedWave.value)}
                            >
                              Refresh
                            </Button>
                          }
                        >
                          Detected Patterns
                        </Header>
                      }
                      selectionType="single"
                      onSelectionChange={({ detail }) =>
                        setSelectedPattern(detail.selectedItems[0] || null)
                      }
                    />
                  </Container>

                  {selectedPattern && (
                    <Container
                      header={
                        <Header
                          variant="h2"
                          actions={
                            <Button
                              iconName="close"
                              variant="icon"
                              onClick={() => setSelectedPattern(null)}
                            />
                          }
                        >
                          Pattern Details
                        </Header>
                      }
                    >
                      <SpaceBetween size="l">
                        <ColumnLayout columns={3} variant="text-grid">
                          <div>
                            <Box variant="awsui-key-label">Pattern Name</Box>
                            <div>{selectedPattern.human_name}</div>
                          </div>
                          <div>
                            <Box variant="awsui-key-label">State</Box>
                            <Badge color={getStateColor(selectedPattern.pattern_state)}>
                              {selectedPattern.pattern_state.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <div>
                            <Box variant="awsui-key-label">Applications</Box>
                            <div>{selectedPattern.application_count}</div>
                          </div>
                        </ColumnLayout>

                        <div>
                          <Box variant="awsui-key-label">Migration Strategy</Box>
                          <Box variant="p">{selectedPattern.migration_strategy}</Box>
                        </div>

                        {selectedPattern.description && (
                          <div>
                            <Box variant="awsui-key-label">Description</Box>
                            <Box variant="p">{selectedPattern.description}</Box>
                          </div>
                        )}

                        <div>
                          <Box variant="awsui-key-label">Pattern Signature</Box>
                          <Box variant="code">{selectedPattern.pattern_signature}</Box>
                        </div>

                        <div>
                          <Box variant="awsui-key-label">Applications</Box>
                          <Table
                            columnDefinitions={[
                              {
                                id: 'app_name',
                                header: 'Application',
                                cell: (item) => item.app_name,
                              },
                              {
                                id: 'change_count',
                                header: 'Changes',
                                cell: (item) => item.change_count,
                              },
                              {
                                id: 'total_components',
                                header: 'Components',
                                cell: (item) => item.total_components,
                              },
                            ]}
                            items={selectedPattern.applications.slice(0, 10)}
                            variant="embedded"
                            empty={
                              <Box textAlign="center" color="inherit">
                                No applications
                              </Box>
                            }
                          />
                          {selectedPattern.applications.length > 10 && (
                            <Box variant="small" color="text-body-secondary">
                              Showing 10 of {selectedPattern.applications.length} applications
                            </Box>
                          )}
                        </div>
                      </SpaceBetween>
                    </Container>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: 'atx-mapping',
              label: 'ATX Mapping',
              content: selectedWave ? (
                <ATXMappingPanel
                  waveId={selectedWave.value}
                  patterns={patterns}
                  onMappingsSubmitted={handleMappingsSubmitted}
                />
              ) : (
                <Alert type="info">Please select a wave first</Alert>
              ),
            },
          ]}
        />
      )}
    </SpaceBetween>
  )
}
