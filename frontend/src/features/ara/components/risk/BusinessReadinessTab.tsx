import {
  Container,
  Header,
  SpaceBetween,
  Box,
  ProgressBar,
  ColumnLayout,
} from '@cloudscape-design/components'

interface BusinessReadinessTabProps {
  data?: any
  loading?: boolean
  assessmentData?: any
  reportData?: any
}

export default function BusinessReadinessTab({
  data,
  loading = false,
  assessmentData,
  reportData,
}: BusinessReadinessTabProps) {
  // Use reportData if available, otherwise fall back to assessmentData
  const report = reportData || assessmentData

  // If no assessment has been run, show placeholder
  if (!report && !data && !loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Box variant="h2" padding={{ bottom: 's' }}>
            No Assessment Data
          </Box>
          <Box variant="p" color="text-body-secondary">
            Select an application and click "Run Assessment" to view business readiness.
          </Box>
        </Box>
      </Container>
    )
  }

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <ProgressBar label="Loading business readiness data..." />
        </Box>
      </Container>
    )
  }

  // Extract business readiness data
  const businessData = report?.business_readiness || {}
  const inputs = businessData.inputs || {}
  const details = businessData.details || {}
  const factors = details.factors || {}  // Backend returns factors inside details
  const overallScore = report?.scores?.business_readiness_score || businessData.business_readiness_score || 0

  const getScoreColor = (score: number): 'success' | 'in-progress' | 'error' => {
    if (score >= 70) return 'success'
    if (score >= 40) return 'in-progress'
    return 'error'
  }

  const getReadinessLabel = (score: number): string => {
    if (score >= 80) return 'Excellent'
    if (score >= 70) return 'Good'
    if (score >= 60) return 'Fair'
    if (score >= 40) return 'Poor'
    return 'Critical'
  }

  return (
    <SpaceBetween size="l">
      {/* Overall Business Readiness Score */}
      <Container
        header={
          <Header variant="h2" description="Overall business preparedness for migration (10% weight)">
            Business Readiness Score
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Overall Business Readiness Score</Box>
            <Box fontSize="display-l" fontWeight="bold">
              {overallScore}/100
            </Box>
            <Box variant="small" color="text-status-info">
              {getReadinessLabel(overallScore)}
            </Box>
          </Box>

          <ProgressBar
            value={overallScore}
            variant="standalone"
            status={getScoreColor(overallScore)}
            label="Business Readiness Score"
            description={`${overallScore}% - ${getReadinessLabel(overallScore)}`}
          />
        </SpaceBetween>
      </Container>

      {/* Assessment Inputs and Scores */}
      <Container
        header={
          <Header variant="h2" description="Questions and answers submitted during assessment">
            Assessment Details
          </Header>
        }
      >
        <ColumnLayout columns={2} variant="text-grid">
          {/* Maintenance Window */}
          <Box>
            <Box variant="awsui-key-label">Maintenance Window (25% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.maintenance_window || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.maintenance_window || 0}
              variant="standalone"
              status={getScoreColor(factors.maintenance_window || 0)}
              label={`Score: ${factors.maintenance_window || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Flexible, Limited, No downtime
            </Box>
          </Box>

          {/* Business Calendar */}
          <Box>
            <Box variant="awsui-key-label">Business Calendar (25% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.business_calendar || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.business_calendar || 0}
              variant="standalone"
              status={getScoreColor(factors.business_calendar || 0)}
              label={`Score: ${factors.business_calendar || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Off-peak, Normal, Peak season
            </Box>
          </Box>

          {/* Stakeholder Alignment */}
          <Box>
            <Box variant="awsui-key-label">Stakeholder Alignment (25% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.stakeholder_alignment || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.stakeholder_alignment || 0}
              variant="standalone"
              status={getScoreColor(factors.stakeholder_alignment || 0)}
              label={`Score: ${factors.stakeholder_alignment || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Full buy-in, Some concerns, Strong resistance
            </Box>
          </Box>

          {/* Budget Availability */}
          <Box>
            <Box variant="awsui-key-label">Budget Availability (25% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.budget_availability || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.budget_availability || 0}
              variant="standalone"
              status={getScoreColor(factors.budget_availability || 0)}
              label={`Score: ${factors.budget_availability || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Fully funded, Partial, No budget
            </Box>
          </Box>
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  )
}
