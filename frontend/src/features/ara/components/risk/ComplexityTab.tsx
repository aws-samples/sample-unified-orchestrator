import { useState } from 'react'
import {
  Container, Header, SpaceBetween, Box, ProgressBar, ColumnLayout, Table, Modal, Button,
} from '@cloudscape-design/components'

interface ComplexityTabProps {
  data?: any
  loading?: boolean
  assessmentData?: any
  reportData?: any
}

const getImpactLabel = (score: number): string => {
  if (score <= 10) return 'Minimal'
  if (score <= 25) return 'Low'
  if (score <= 50) return 'Moderate'
  if (score <= 75) return 'High'
  return 'Very High'
}

const TESTING_DESCRIPTIONS: Record<string, string> = {
  'Full Pyramid': 'Comprehensive test suite (unit + integration + e2e) — migration can proceed with high confidence.',
  'Unit + Integration': 'Good coverage with unit and integration tests — moderate confidence for migration.',
  'Unit Only': 'Only unit tests detected — integration and e2e gaps increase migration risk.',
  'No Tests': 'No automated tests detected — migration carries high risk without manual validation.',
  'Unknown': 'Testing maturity could not be determined from the repository.',
}

export default function ComplexityTab({ data, loading = false, assessmentData, reportData }: ComplexityTabProps) {
  const report = reportData || assessmentData
  const [expandedModal, setExpandedModal] = useState<string | null>(null)

  if (!report && !data && !loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Box variant="h2" padding={{ bottom: 's' }}>No Assessment Data</Box>
          <Box variant="p" color="text-body-secondary">Select an application and click "Run Assessment" to view complexity analysis.</Box>
        </Box>
      </Container>
    )
  }

  if (loading) {
    return <Container><Box textAlign="center" padding="xxl"><ProgressBar label="Loading complexity data..." /></Box></Container>
  }

  const complexityData = report?.complexity || {}
  const metrics = complexityData.metrics || {}
  const complexityScore = report?.scores?.complexity_score || complexityData.complexity_score || 0
  const testingMaturity = metrics.testing_maturity || 'Unknown'
  const testingDescription = TESTING_DESCRIPTIONS[testingMaturity] || TESTING_DESCRIPTIONS['Unknown']

  const getScoreColor = (score: number): 'success' | 'in-progress' | 'error' => {
    if (score <= 30) return 'success'
    if (score <= 60) return 'in-progress'
    return 'error'
  }
  const getComplexityLabel = (score: number): string => {
    if (score <= 20) return 'Very Low'
    if (score <= 40) return 'Low'
    if (score <= 60) return 'Moderate'
    if (score <= 80) return 'High'
    return 'Very High'
  }

  const integrationCols = [
    { id: 'type', header: 'Service Type', cell: (item: any) => item.type },
    { id: 'detail', header: 'Detail', cell: (item: any) => item.detail },
    { id: 'source', header: 'Detected In', cell: (item: any) => item.source },
    { id: 'repository', header: 'Repository', cell: (item: any) => item.repository || '—' },
  ]
  const appTypeCols = [
    { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
    { id: 'type', header: 'App Type', cell: (item: any) => item.type },
    { id: 'framework', header: 'Framework', cell: (item: any) => item.framework !== 'Unknown' ? item.framework : '—' },
    { id: 'score', header: 'Score', cell: (item: any) => `${item.score}/100` },
  ]
  const testingCols = [
    { id: 'repository', header: 'Repository', cell: (item: any) => item.repository || '—' },
    { id: 'aspect', header: 'Aspect', cell: (item: any) => item.aspect },
    { id: 'status', header: 'Status', cell: (item: any) => item.status },
    { id: 'detail', header: 'Detail', cell: (item: any) => item.detail },
  ]

  const integrations = (metrics.integrations || []) as any[]
  const appTypeDetails = (() => {
    const details = metrics.application_type_details as any[] | undefined
    return details && details.length > 0
      ? details
      : [{ repository: '—', type: metrics.application_type || 'Unknown', framework: metrics.application_type_framework || 'Unknown', score: metrics.application_type_score || 0 }]
  })()
  const testingDetails = (metrics.testing_details || []) as any[]

  const ExpandBtn = ({ id, count }: { id: string; count: number }) =>
    count > 0 ? (
      <Button variant="icon" iconName="expand" ariaLabel="Expand" onClick={() => setExpandedModal(id)} />
    ) : null

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description="Overall migration complexity assessment (25% weight)">Complexity Score</Header>}>
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Overall Complexity Score</Box>
            <Box fontSize="display-l" fontWeight="bold">{complexityScore}/100</Box>
            <Box variant="small" color="text-status-info">{getComplexityLabel(complexityScore)}</Box>
          </Box>
          <ProgressBar value={complexityScore} variant="standalone" status={getScoreColor(complexityScore)} label="Complexity Score" description={`${complexityScore}% - ${getComplexityLabel(complexityScore)}`} />
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2" description="Detailed breakdown of complexity factors">Complexity Factors</Header>}>
        <ColumnLayout columns={2} variant="text-grid">
          {/* Integration Count */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Integration Count (25% weight)</Box>
              <ExpandBtn id="integrations" count={integrations.length} />
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">{metrics.integration_score || 0}/100</Box>
            <ProgressBar value={metrics.integration_score || 0} variant="standalone" status={getScoreColor(metrics.integration_score || 0)} />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {metrics.integration_count || 0} external system{(metrics.integration_count || 0) !== 1 ? 's' : ''} — {getImpactLabel(metrics.integration_score || 0)} complexity impact
            </Box>
            {integrations.length > 0 && (
              <Box padding={{ top: 's' }}>
                <div style={{ maxHeight: '175px', overflowY: 'auto' }}>
                  <Table columnDefinitions={integrationCols} items={integrations} variant="embedded" stripedRows sortingDisabled wrapLines
                    ariaLabels={{ tableLabel: 'External integrations' }} empty={<Box textAlign="center">No integrations</Box>} />
                </div>
              </Box>
            )}
          </Box>

          {/* Machine Count */}
          <Box>
            <Box variant="awsui-key-label" fontWeight="bold">Machine Count (20% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">{metrics.machine_count_score || 0}/100</Box>
            <ProgressBar value={metrics.machine_count_score || 0} variant="standalone" status={getScoreColor(metrics.machine_count_score || 0)} />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              <Box fontWeight="bold" display="inline">{metrics.machine_count || 0}</Box> unique machine{(metrics.machine_count || 0) !== 1 ? 's' : ''} — {getImpactLabel(metrics.machine_count_score || 0)} complexity impact
            </Box>
          </Box>

          {/* Application Type */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Application Type (15% weight)</Box>
              <ExpandBtn id="appType" count={appTypeDetails.length} />
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">{metrics.application_type_score || 0}/100</Box>
            <ProgressBar value={metrics.application_type_score || 0} variant="standalone" status={getScoreColor(metrics.application_type_score || 0)} />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>{getImpactLabel(metrics.application_type_score || 0)} complexity impact</Box>
            <Box padding={{ top: 's' }}>
              <div style={{ maxHeight: '175px', overflowY: 'auto' }}>
                <Table columnDefinitions={appTypeCols} items={appTypeDetails} variant="embedded" stripedRows sortingDisabled wrapLines
                  ariaLabels={{ tableLabel: 'Application type details' }} empty={<Box textAlign="center">No details</Box>} />
              </div>
            </Box>
          </Box>

          {/* Testing Maturity */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Testing Maturity (10% weight)</Box>
              <ExpandBtn id="testing" count={testingDetails.length} />
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">{metrics.testing_maturity_score || 0}/100</Box>
            <ProgressBar value={metrics.testing_maturity_score || 0} variant="standalone" status={getScoreColor(metrics.testing_maturity_score || 0)} />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>{testingMaturity} — {getImpactLabel(metrics.testing_maturity_score || 0)} complexity impact. {testingDescription}</Box>
            {testingDetails.length > 0 && (
              <Box padding={{ top: 's' }}>
                <div style={{ maxHeight: '175px', overflowY: 'auto' }}>
                  <Table columnDefinitions={testingCols} items={testingDetails} variant="embedded" stripedRows sortingDisabled wrapLines
                    ariaLabels={{ tableLabel: 'Testing maturity details' }} empty={<Box textAlign="center">No details</Box>} />
                </div>
              </Box>
            )}
          </Box>

          {/* Data Migration Size */}
          <Box>
            <Box variant="awsui-key-label">Data Migration Size (10% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">{metrics.data_migration_size_score || 0}/100</Box>
            <ProgressBar value={metrics.data_migration_size_score || 0} variant="standalone" status={getScoreColor(metrics.data_migration_size_score || 0)} />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {metrics.data_migration_size || 'Unknown'} — {getImpactLabel(metrics.data_migration_size_score || 0)} complexity impact
            </Box>
          </Box>
        </ColumnLayout>
      </Container>

      {/* Expand Modals */}
      <Modal visible={expandedModal === 'integrations'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`External Integrations (${integrations.length})`}>
        <Table columnDefinitions={integrationCols} items={integrations} variant="embedded" stripedRows sortingDisabled wrapLines
          ariaLabels={{ tableLabel: 'External integrations' }} />
      </Modal>
      <Modal visible={expandedModal === 'appType'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`Application Type Details (${appTypeDetails.length})`}>
        <Table columnDefinitions={appTypeCols} items={appTypeDetails} variant="embedded" stripedRows sortingDisabled wrapLines
          ariaLabels={{ tableLabel: 'Application type details' }} />
      </Modal>
      <Modal visible={expandedModal === 'testing'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`Testing Maturity Details (${testingDetails.length})`}>
        <Table columnDefinitions={testingCols} items={testingDetails} variant="embedded" stripedRows sortingDisabled wrapLines
          ariaLabels={{ tableLabel: 'Testing maturity details' }} />
      </Modal>
    </SpaceBetween>
  )
}
