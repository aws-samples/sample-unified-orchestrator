import {
  Container,
  Header,
  SpaceBetween,
  Box,
  ProgressBar,
  ColumnLayout,
} from '@cloudscape-design/components'

interface TeamReadinessTabProps {
  data?: any
  loading?: boolean
  assessmentData?: any
  reportData?: any
}

export default function TeamReadinessTab({ data, loading = false, assessmentData, reportData }: TeamReadinessTabProps) {
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
            Select an application and click "Run Assessment" to view team readiness.
          </Box>
        </Box>
      </Container>
    )
  }

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <ProgressBar label="Loading team readiness data..." />
        </Box>
      </Container>
    )
  }

  // Extract team readiness data
  const teamData = report?.team_readiness || {}
  const inputs = teamData.inputs || {}
  const details = teamData.details || {}
  const factors = details.factors || {}  // Backend returns factors inside details
  const overallScore = report?.scores?.team_readiness_score || teamData.team_readiness_score || 0

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
      {/* Overall Team Readiness Score */}
      <Container
        header={
          <Header variant="h2" description="Overall team preparedness for migration (10% weight)">
            Team Readiness Score
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Overall Team Readiness Score</Box>
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
            label="Team Readiness Score"
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
          {/* Team Availability */}
          <Box>
            <Box variant="awsui-key-label">Team Availability (30% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.team_availability || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.team_availability || 0}
              variant="standalone"
              status={getScoreColor(factors.team_availability || 0)}
              label={`Score: ${factors.team_availability || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Dedicated, Part-time, None
            </Box>
          </Box>

          {/* Skill Level */}
          <Box>
            <Box variant="awsui-key-label">Skill Level (30% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.skill_level || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.skill_level || 0}
              variant="standalone"
              status={getScoreColor(factors.skill_level || 0)}
              label={`Score: ${factors.skill_level || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Expert, Some experience, No experience
            </Box>
          </Box>

          {/* Knowledge Transfer */}
          <Box>
            <Box variant="awsui-key-label">Knowledge Transfer (25% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.knowledge_transfer || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.knowledge_transfer || 0}
              variant="standalone"
              status={getScoreColor(factors.knowledge_transfer || 0)}
              label={`Score: ${factors.knowledge_transfer || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: Full docs + devs, Key person, Docs only, None
            </Box>
          </Box>

          {/* Training Completed */}
          <Box>
            <Box variant="awsui-key-label">Training Completed (15% weight)</Box>
            <Box fontSize="heading-m" fontWeight="bold">
              {inputs.training_completed || '(Not provided)'}
            </Box>
            <ProgressBar
              value={factors.training_completed || 0}
              variant="standalone"
              status={getScoreColor(factors.training_completed || 0)}
              label={`Score: ${factors.training_completed || 0}/100`}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Options: All trained, Some trained, No training
            </Box>
          </Box>
        </ColumnLayout>
      </Container>
    </SpaceBetween>
  )
}
