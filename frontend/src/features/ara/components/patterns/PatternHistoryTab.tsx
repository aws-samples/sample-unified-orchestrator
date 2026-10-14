import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Header,
  Table,
  Box,
  Badge,
  Button,
  TableProps,
  SpaceBetween,
  Select,
  FormField,
  ColumnLayout,
  SelectProps,
} from '@cloudscape-design/components'
import { listWavePatternAnalyses } from '../../services/patterns'

interface AnalysisMetadata {
  analysis_id: string
  wave_id: string
  s3_key: string
  last_modified: string
  size: number
}

interface AnalysisSummary extends AnalysisMetadata {
  total_applications?: number
  unique_patterns?: number
  applications_with_patterns?: number
  applications_without_patterns?: number
  is_latest?: boolean
}

export default function PatternHistoryTab() {
  const navigate = useNavigate()
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [selectedWave, setSelectedWave] = useState<SelectProps.Option | null>(null)
  const [waves] = useState<string[]>(['wave0', 'wave1', 'wave2'])

  useEffect(() => {
    loadAllAnalyses()
  }, [])

  const loadAllAnalyses = async () => {
    try {
      setLoading(true)
      const allAnalyses: AnalysisSummary[] = []

      // Load analyses for all waves (metadata only, no details)
      for (const wave of waves) {
        try {
          const response = await listWavePatternAnalyses(wave)
          if (response.success && response.analyses) {
            // Just add metadata, don't fetch details (too slow)
            allAnalyses.push(...response.analyses.map(a => ({
              ...a,
              total_applications: undefined,
              unique_patterns: undefined,
              applications_with_patterns: undefined,
              applications_without_patterns: undefined,
            })))
          }
        } catch (err) {
          // Use structured logging to prevent log injection
          console.error('Error loading analyses for wave', { wave, error: err })
        }
      }

      setAnalyses(allAnalyses)
    } catch (error) {
      console.error('Error loading analyses:', error)
    } finally {
      setLoading(false)
    }
  }

  // Filter analyses by wave
  const filteredAnalyses = analyses.filter(analysis => {
    if (selectedWave?.value && analysis.wave_id !== selectedWave.value) return false
    return true
  })

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString()
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const viewAnalysis = async (waveId: string, analysisId: string) => {
    // Navigate to the Wave Analysis Results page with the historical analysis ID
    navigate(`/patterns/results/${waveId}?analysisId=${analysisId}`)
  }

  const columns: TableProps.ColumnDefinition<AnalysisSummary>[] = [
    {
      id: 'wave',
      header: 'Wave',
      cell: (i) => <Badge color="blue">{i.wave_id}</Badge>,
      width: 100
    },
    {
      id: 'date',
      header: 'Analysis Date',
      cell: (i) => (
        <SpaceBetween direction="horizontal" size="xs">
          <span>{formatDate(i.last_modified)}</span>
        </SpaceBetween>
      ),
      width: 220
    },
    {
      id: 'id',
      header: 'Analysis ID',
      cell: (i) => (
        <Box variant="code">
          {i.analysis_id}
        </Box>
      ),
      width: 200
    },
    {
      id: 'size',
      header: 'Size',
      cell: (i) => formatSize(i.size),
      width: 100
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (i) => (
        <Button
          variant="inline-link"
          onClick={() => viewAnalysis(i.wave_id, i.analysis_id)}
        >
          View
        </Button>
      ),
      width: 100
    }
  ]

  return (
    <SpaceBetween size="l">
      {/* Filters */}
      <Container header={<Header variant="h2">Filters</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Filter by Wave">
            <Select
              selectedOption={selectedWave}
              onChange={(event: any) => setSelectedWave(event.detail.selectedOption)}
              options={[
                { label: 'All Waves', value: '' },
                ...waves.map((wave: string) => ({ label: wave, value: wave }))
              ]}
              placeholder="Select wave"
            />
          </FormField>

          <FormField label="Actions">
            <Button onClick={() => setSelectedWave(null)}>
              Clear Filters
            </Button>
          </FormField>
        </ColumnLayout>
      </Container>

      {/* Pattern Analysis History - Flat Table */}
      <Container
        header={
          <Header
            variant="h2"
            description="All pattern analyses across waves"
            actions={
              <Button
                iconName="refresh"
                onClick={loadAllAnalyses}
                loading={loading}
              >
                Refresh
              </Button>
            }
            counter={`(${filteredAnalyses.length} analyses)`}
          >
            Application Pattern Analysis History
          </Header>
        }
      >
        {loading ? (
          <Box textAlign="center" padding={{ vertical: 'l' }}>
            Loading pattern analyses...
          </Box>
        ) : filteredAnalyses.length === 0 ? (
          <Box textAlign="center" padding={{ vertical: 'l' }}>
            <SpaceBetween size="m">
              <Box variant="p">
                <strong>No pattern analyses found</strong>
              </Box>
              <Box variant="p" color="text-body-secondary">
                Run a pattern analysis to see results here.
              </Box>
            </SpaceBetween>
          </Box>
        ) : (
          <Table
            columnDefinitions={columns}
            items={filteredAnalyses}
            stripedRows
            wrapLines={false}
            sortingDisabled
          />
        )}
      </Container>
    </SpaceBetween>
  )
}
