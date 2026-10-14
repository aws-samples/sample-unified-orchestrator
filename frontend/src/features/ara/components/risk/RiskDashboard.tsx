import { useState, useEffect } from 'react'
import {
  Container,
  Header,
  Tabs,
  SpaceBetween,
  Button,
  Select,
  SelectProps,
  ProgressBar,
  FormField,
  SegmentedControl,
  SegmentedControlProps,
} from '@cloudscape-design/components'

import RiskSummaryTab from './RiskSummaryTab'
import RiskScoreTab from './RiskScoreTab'
import ComplexityTab from './ComplexityTab'
import MigrationReadinessTab from './MigrationReadinessTab'
import TeamReadinessTab from './TeamReadinessTab'
import BusinessReadinessTab from './BusinessReadinessTab'
import ReadinessInputWizard, { ReadinessInputs } from './ReadinessInputWizard'
import apiClient from '../../../uno/services/api'

interface RiskDashboardProps {
  entityType?: 'application' | 'pod' | 'wave'
  entityId?: string
}

interface Application {
  application_id: string
  application_name: string
  WAVE: string
  wave?: string
}

interface WaveSummary {
  total_applications: number
  wave_distribution: Record<string, number>
  applications: Application[]
}

// Mock data for pods (waves will be fetched from API)
const mockPods: SelectProps.Option[] = [
  { label: 'Frontend Pod', value: 'pod-1', description: 'All frontend applications' },
  { label: 'Backend Services Pod', value: 'pod-2', description: 'Core backend microservices' },
  { label: 'Data Processing Pod', value: 'pod-3', description: 'ETL and data pipelines' },
  { label: 'Infrastructure Pod', value: 'pod-4', description: 'Infrastructure and DevOps tools' },
]

export default function RiskDashboard({ entityType: initialEntityType = 'application', entityId }: RiskDashboardProps) {

  const [activeTabId, setActiveTabId] = useState('history')
  const [entityType, setEntityType] = useState<'application' | 'pod' | 'wave'>(initialEntityType)
  const [selectedEntity, setSelectedEntity] = useState<SelectProps.Option | null>(
    entityId ? { label: entityId, value: entityId } : null
  )
  const [isAssessing, setIsAssessing] = useState(false)
  const [assessmentProgress, setAssessmentProgress] = useState(0)
  const [assessmentStage, setAssessmentStage] = useState('')
  const [assessmentError, setAssessmentError] = useState<string | null>(null)
  const [showWizard, setShowWizard] = useState(false)

  // State for applications fetched from API
  const [applications, setApplications] = useState<Application[]>([])
  const [loadingApplications, setLoadingApplications] = useState(false)
  const [waves, setWaves] = useState<string[]>([])

  // State for assessment results
  const [assessmentResults, setAssessmentResults] = useState<any>(null)

  // Fetch applications from API on component mount
  useEffect(() => {
    loadApplications()
  }, [])

  const loadApplications = async () => {
    try {
      setLoadingApplications(true)
      const response = await apiClient.get<{ success: boolean; data: WaveSummary; error?: string }>('/wave/applications')

      if (response.data.success) {
        const allApps = response.data.data.applications
        setApplications(allApps)

        // Extract unique waves (exclude empty / unassigned for the wave filter)
        const uniqueWaves = [...new Set(allApps.map(app => app.WAVE || app.wave || ''))].filter(
          w => w && w.trim() !== '' && w !== 'unassigned'
        )
        setWaves(uniqueWaves.sort())
      } else {
        console.error('Failed to load applications:', response.data.error)
      }
    } catch (error) {
      console.error('Error loading applications:', error)
    } finally {
      setLoadingApplications(false)
    }
  }

  // Convert applications to Select options
  const getApplicationOptions = (): SelectProps.Option[] => {
    return applications.map(app => {
      const wave = app.WAVE || app.wave || ''
      return {
        label: app.application_name,
        value: app.application_id,
        description: `Wave: ${wave && wave !== 'unassigned' ? wave : 'Unassigned'}`
      }
    })
  }

  // Convert waves to Select options
  const getWaveOptions = (): SelectProps.Option[] => {
    return waves.map(wave => {
      const appCount = applications.filter(app => (app.WAVE || app.wave) === wave).length
      return {
        label: wave,
        value: wave,
        description: `${appCount} application${appCount !== 1 ? 's' : ''}`
      }
    })
  }

  // Get entity options based on selected type
  const getEntityOptions = (): SelectProps.Option[] => {
    switch (entityType) {
      case 'application':
        return getApplicationOptions()
      case 'pod':
        return mockPods
      case 'wave':
        return getWaveOptions()
      default:
        return []
    }
  }

  // Reset selected entity when entity type changes
  useEffect(() => {
    setSelectedEntity(null)
  }, [entityType])

  const entityTypeOptions: SegmentedControlProps.Option[] = [
    { id: 'application', text: 'Application' },
    { id: 'pod', text: 'Pod' },
    { id: 'wave', text: 'Wave' },
  ]

  const handleRunAssessment = () => {
    if (!selectedEntity) return

    // Show wizard only for application-level assessments
    if (entityType === 'application') {
      setShowWizard(true)
      return
    }

    // For pod/wave assessments, use full scores (100) and proceed directly
    startAssessment(null)
  }

  const handleWizardSubmit = (inputs: ReadinessInputs) => {
    startAssessment(inputs)
  }

  const startAssessment = async (inputs: ReadinessInputs | null) => {
    if (!selectedEntity) return

    setIsAssessing(true)
    setAssessmentProgress(0)
    setAssessmentStage('Initializing assessment...')
    setAssessmentError(null)

    try {
      // Prepare the request payload based on entity type
      const payload: any = {}

      if (entityType === 'application') {
        payload.application_id = selectedEntity.value
        // Add readiness inputs if provided (only for application-level assessments)
        if (inputs) {
          payload.team_readiness_inputs = {
            team_availability: inputs.team.teamAvailability,
            skill_level: inputs.team.skillLevel,
            knowledge_transfer: inputs.team.knowledgeTransfer,
            training_completed: inputs.team.trainingCompleted
          }
          payload.business_readiness_inputs = {
            maintenance_window: inputs.business.maintenanceWindow,
            business_calendar: inputs.business.businessCalendar,
            stakeholder_alignment: inputs.business.stakeholderAlignment,
            budget_availability: inputs.business.budgetAvailability
          }
        }
      } else if (entityType === 'pod') {
        payload.pod_id = selectedEntity.value
      } else if (entityType === 'wave') {
        payload.wave_id = selectedEntity.value
      }

      // Simulate progress stages
      const stages = [
        { progress: 10, stage: 'Fetching application data...', duration: 800 },
        { progress: 20, stage: 'Analyzing EOSL risks...', duration: 1000 },
        { progress: 35, stage: 'Evaluating security vulnerabilities...', duration: 1200 },
        { progress: 50, stage: 'Calculating complexity score...', duration: 1000 },
      ]

      let currentStageIndex = 0
      const progressInterval = setInterval(() => {
        if (currentStageIndex < stages.length) {
          const stage = stages[currentStageIndex]
          setAssessmentProgress(stage.progress)
          setAssessmentStage(stage.stage)
          currentStageIndex++
        }
      }, 800)

      // Call the backend API
      const response = await apiClient.post('/ara/risk/assess', payload)

      clearInterval(progressInterval)

      if (response.data.error) {
        setAssessmentError(response.data.error)
        setIsAssessing(false)
        return
      }

      // Continue with remaining stages
      const remainingStages = [
        { progress: 65, stage: 'Assessing migration readiness...', duration: 1000 },
        { progress: 75, stage: 'Evaluating team readiness...', duration: 800 },
        { progress: 85, stage: 'Checking business readiness...', duration: 800 },
        { progress: 95, stage: 'Generating actionable items...', duration: 600 },
        { progress: 100, stage: 'Assessment complete', duration: 500 },
      ]

      for (const stage of remainingStages) {
        await new Promise(resolve => setTimeout(resolve, stage.duration))
        setAssessmentProgress(stage.progress)
        setAssessmentStage(stage.stage)
      }

      // Store the assessment result
      const assessmentId = response.data.assessment_id
      if (assessmentId) {
        const assessmentResponse = await apiClient.get(`/ara/risk/assessments/${assessmentId}`)
        setAssessmentResults(assessmentResponse.data)
      } else {
        setAssessmentResults(response.data)
      }

      setIsAssessing(false)

    } catch (error) {
      console.error('Error running assessment:', error)
      setAssessmentError(
        error instanceof Error
          ? error.message
          : 'Failed to run assessment. Please try again.'
      )
      setIsAssessing(false)
    }
  }

  const getEntityTypeLabel = (): string => {
    switch (entityType) {
      case 'application':
        return 'Application'
      case 'pod':
        return 'Pod'
      case 'wave':
        return 'Wave'
      default:
        return 'Entity'
    }
  }

  const tabs = [
    {
      id: 'summary',
      label: 'Overall Summary',
      content: <RiskSummaryTab loading={isAssessing} assessmentData={assessmentResults} />,
    },
    {
      id: 'risk-score',
      label: 'Risk Score',
      content: <RiskScoreTab loading={isAssessing} assessmentData={assessmentResults} />,
    },
    {
      id: 'complexity',
      label: 'Complexity',
      content: <ComplexityTab loading={isAssessing} assessmentData={assessmentResults} />,
    },
    {
      id: 'migration-readiness',
      label: 'Migration Readiness',
      content: <MigrationReadinessTab loading={isAssessing} reportData={assessmentResults} />,
    },
    {
      id: 'team-readiness',
      label: 'Team Readiness',
      content: <TeamReadinessTab loading={isAssessing} assessmentData={assessmentResults} />,
    },
    {
      id: 'business-readiness',
      label: 'Business Readiness',
      content: <BusinessReadinessTab loading={isAssessing} assessmentData={assessmentResults} />,
    },
  ]

  return (
    <SpaceBetween size="l">
      <ReadinessInputWizard
        visible={showWizard}
        onDismiss={() => setShowWizard(false)}
        onSubmit={handleWizardSubmit}
      />

      <Container
        header={
          <Header
            variant="h2"
            description="Select an entity type and specific entity to assess migration readiness"
            actions={
              <Button
                variant="primary"
                onClick={handleRunAssessment}
                disabled={!selectedEntity || isAssessing}
                loading={isAssessing}
              >
                Run Assessment
              </Button>
            }
          >
            Risk Assessment
          </Header>
        }
      >
        <SpaceBetween size="m">
          <FormField
            label="Entity Type"
            description="Choose whether to assess an individual application, a pod of applications, or an entire wave"
          >
            <SegmentedControl
              selectedId={entityType}
              onChange={({ detail }) =>
                setEntityType(detail.selectedId as 'application' | 'pod' | 'wave')
              }
              options={entityTypeOptions}
            />
          </FormField>

          <FormField
            label={`Select ${getEntityTypeLabel()}`}
            description={`Choose a specific ${entityType} to assess`}
          >
            <Select
              selectedOption={selectedEntity}
              onChange={({ detail }) => setSelectedEntity(detail.selectedOption)}
              options={getEntityOptions()}
              placeholder={`Select ${getEntityTypeLabel()}`}
              filteringType="auto"
              empty={loadingApplications ? "Loading..." : "No options available"}
              disabled={isAssessing || loadingApplications}
              loadingText={loadingApplications ? "Loading..." : undefined}
            />
          </FormField>

          {isAssessing && (
            <SpaceBetween size="s">
              <ProgressBar
                value={assessmentProgress}
                label="Assessment in progress"
                description={assessmentStage}
                resultText="Assessment complete"
                status={assessmentProgress === 100 ? 'success' : 'in-progress'}
              />
              {assessmentProgress < 100 && (
                <div style={{
                  fontSize: '12px',
                  color: '#5f6b7a',
                  textAlign: 'center'
                }}>
                  This may take a few moments. Please do not close this window.
                </div>
              )}
            </SpaceBetween>
          )}

          {assessmentError && (
            <div style={{
              padding: '12px',
              backgroundColor: '#fef6f6',
              borderLeft: '4px solid #d91515',
              borderRadius: '4px',
              fontSize: '14px',
              color: '#d91515'
            }}>
              <strong>Assessment Error:</strong> {assessmentError}
            </div>
          )}

          {selectedEntity && !isAssessing && (
            <div style={{
              padding: '12px',
              backgroundColor: '#f2f3f3',
              borderRadius: '8px',
              fontSize: '14px'
            }}>
              <strong>Selected:</strong> {selectedEntity.label}
              {selectedEntity.description && (
                <div style={{ marginTop: '4px', color: '#5f6b7a' }}>
                  {selectedEntity.description}
                </div>
              )}
            </div>
          )}
        </SpaceBetween>
      </Container>

      <Tabs
        activeTabId={activeTabId}
        onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
        tabs={tabs}
      />
    </SpaceBetween>
  )
}
