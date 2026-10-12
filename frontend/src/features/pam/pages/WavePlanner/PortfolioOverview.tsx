import { useEffect, useState } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Box,
  ColumnLayout,
  ExpandableSection,
  Table,
  Spinner,
  Alert,
} from '@cloudscape-design/components'
import { PieChart } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'

// Data models based on design document
interface BucketStats {
  applicationCount: number
  avgScore: number
  minScore: number
  maxScore: number
}

interface ComplexitySummary {
  totalApplications: number
  buckets: Record<'LOW' | 'MEDIUM' | 'HIGH', BucketStats>
}

interface DataQualityIssue {
  motsId: number
  appName: string
  totalScore: number
  dataConfidence: number
  unknownFields: string[]
  unknownCount: number
}

interface DataQualityPage {
  content: DataQualityIssue[]
  page: { totalElements: number; totalPages: number; size: number; number: number }
}

interface PageResponse {
  content: unknown[]
  page: { totalElements: number; totalPages: number; size: number; number: number }
}

interface PortfolioState {
  totalApps: number | null
  complexitySummary: ComplexitySummary | null
  dataQualityIssues: DataQualityIssue[]
  loading: boolean
  error: string | null
  dqExpanded: boolean
}

export default function PortfolioOverview() {
  const [state, setState] = useState<PortfolioState>({
    totalApps: null,
    complexitySummary: null,
    dataQualityIssues: [],
    loading: true,
    error: null,
    dqExpanded: false,
  })

  useEffect(() => {
    fetchPortfolioData()
  }, [])

  const fetchPortfolioData = async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }))

      // Fetch total applications count
      const totalAppsResponse = await dualApiClient<PageResponse>(
        '/api/applications',
        {
          backend: 'migration-refinery',
          params: { page: 0, size: 1 }
        }
      )

      // Fetch complexity summary
      const complexitySummary = await dualApiClient<ComplexitySummary>(
        '/api/applications/complexity/summary',
        { backend: 'migration-refinery' }
      )

      // Fetch data quality issues
      const dqIssuesResponse = await dualApiClient<DataQualityPage>(
        '/api/applications/complexity/data-quality-issues',
        {
          backend: 'migration-refinery',
          params: { page: 0, size: 500 }
        }
      )

      setState(prev => ({
        ...prev,
        totalApps: totalAppsResponse.page.totalElements,
        complexitySummary,
        dataQualityIssues: dqIssuesResponse.content,
        loading: false,
      }))
    } catch (err) {
      console.error('API Error:', err)
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }))
    }
  }

  const calculateAverageComplexity = (): number => {
    if (!state.complexitySummary) return 0
    const { buckets } = state.complexitySummary
    const totalScore =
      buckets.LOW.avgScore * buckets.LOW.applicationCount +
      buckets.MEDIUM.avgScore * buckets.MEDIUM.applicationCount +
      buckets.HIGH.avgScore * buckets.HIGH.applicationCount
    const totalApps =
      buckets.LOW.applicationCount +
      buckets.MEDIUM.applicationCount +
      buckets.HIGH.applicationCount
    return totalApps > 0 ? totalScore / totalApps : 0
  }

  const calculateDataQuality = (): number => {
    if (state.dataQualityIssues.length === 0 || !state.totalApps) return 100
    const appsWithIssues = state.dataQualityIssues.length
    const appsWithoutIssues = state.totalApps - appsWithIssues
    return state.totalApps > 0 ? (appsWithoutIssues / state.totalApps) * 100 : 100
  }

  const getComplexityChartData = () => {
    if (!state.complexitySummary) return []
    const { buckets } = state.complexitySummary
    return [
      { title: 'Low', value: buckets.LOW.applicationCount, color: '#1f77b4' },
      { title: 'Medium', value: buckets.MEDIUM.applicationCount, color: '#ff7f0e' },
      { title: 'High', value: buckets.HIGH.applicationCount, color: '#d62728' },
    ]
  }

  if (state.loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: 's' }}>
            Loading portfolio data...
          </Box>
        </Box>
      </Container>
    )
  }

  if (state.error) {
    return (
      <Container>
        <Alert
          type="error"
          header="Failed to load portfolio data"
          action={
            <button onClick={fetchPortfolioData}>
              Retry
            </button>
          }
        >
          {state.error}
        </Alert>
      </Container>
    )
  }

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Portfolio Statistics</Header>}>
        <ColumnLayout columns={3} variant="text-grid">
          <div>
            <Box variant="awsui-key-label">Total Applications</Box>
            <Box variant="awsui-value-large">{state.totalApps ?? 0}</Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Average Complexity Score</Box>
            <Box variant="awsui-value-large">
              {calculateAverageComplexity().toFixed(2)}
            </Box>
          </div>
          <div>
            <Box variant="awsui-key-label">Data Quality</Box>
            <Box variant="awsui-value-large">
              {calculateDataQuality().toFixed(1)}%
            </Box>
          </div>
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h2">Complexity Distribution</Header>}>
        {state.complexitySummary && (
          <PieChart
            data={getComplexityChartData()}
            detailPopoverContent={(datum) => [
              { key: 'Applications', value: datum.value },
              {
                key: 'Average Score',
                value: state.complexitySummary!.buckets[
                  datum.title.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH'
                ].avgScore.toFixed(2)
              },
            ]}
            segmentDescription={(datum, sum) =>
              `${datum.value} applications, ${((datum.value / sum) * 100).toFixed(0)}%`
            }
            ariaLabel="Complexity distribution chart"
            ariaDescription="Pie chart showing the distribution of applications by complexity level"
            hideFilter
            size="medium"
            variant="donut"
            innerMetricDescription="applications"
            innerMetricValue={state.totalApps?.toString() ?? '0'}
          />
        )}
      </Container>

      <Container>
        <ExpandableSection
          headerText={`Data Quality Issues (${state.dataQualityIssues.length})`}
          variant="container"
          expanded={state.dqExpanded}
          onChange={({ detail }) =>
            setState(prev => ({ ...prev, dqExpanded: detail.expanded }))
          }
        >
          <Table
            columnDefinitions={[
              {
                id: 'motsId',
                header: 'MOTS ID',
                cell: (item: DataQualityIssue) => item.motsId,
                sortingField: 'motsId',
              },
              {
                id: 'appName',
                header: 'Application Name',
                cell: (item: DataQualityIssue) => item.appName,
                sortingField: 'appName',
              },
              {
                id: 'dataConfidence',
                header: 'Data Confidence',
                cell: (item: DataQualityIssue) =>
                  `${(item.dataConfidence * 100).toFixed(1)}%`,
                sortingField: 'dataConfidence',
              },
              {
                id: 'unknownCount',
                header: 'Unknown Fields',
                cell: (item: DataQualityIssue) => item.unknownCount,
                sortingField: 'unknownCount',
              },
              {
                id: 'unknownFields',
                header: 'Field Names',
                cell: (item: DataQualityIssue) =>
                  item.unknownFields.join(', ') || '-',
              },
            ]}
            items={state.dataQualityIssues}
            loadingText="Loading data quality issues"
            sortingDisabled={false}
            empty={
              <Box textAlign="center" color="inherit">
                <b>No data quality issues found</b>
                <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                  All applications have complete data.
                </Box>
              </Box>
            }
            variant="embedded"
          />
        </ExpandableSection>
      </Container>
    </SpaceBetween>
  )
}
