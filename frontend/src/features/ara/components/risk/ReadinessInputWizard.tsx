import { useState } from 'react'
import {
  Wizard,
  Modal,
  Container,
  SpaceBetween,
  FormField,
  Select,
  SelectProps,
  Box,
  ColumnLayout,
  Alert,
} from '@cloudscape-design/components'

export interface TeamReadinessInputs {
  teamAvailability: number
  skillLevel: number
  knowledgeTransfer: number
  trainingCompleted: number
}

export interface BusinessReadinessInputs {
  maintenanceWindow: number
  businessCalendar: number
  stakeholderAlignment: number
  budgetAvailability: number
}

export interface ReadinessInputs {
  team: TeamReadinessInputs
  business: BusinessReadinessInputs
}

interface ReadinessInputWizardProps {
  visible: boolean
  onDismiss: () => void
  onSubmit: (inputs: ReadinessInputs) => void
}

// Team Readiness Options (matching migration-application-score.md)
const teamAvailabilityOptions: SelectProps.Option[] = [
  { label: 'Dedicated', value: '100', description: 'Dedicated team available' },
  { label: 'Part-time', value: '50', description: 'Part-time team availability' },
  { label: 'None', value: '0', description: 'No team assigned' },
]

const skillLevelOptions: SelectProps.Option[] = [
  { label: 'Expert', value: '100', description: 'Expert team with target platform experience' },
  { label: 'Some experience', value: '50', description: 'Team has some experience' },
  { label: 'No experience', value: '0', description: 'No experience with target platform' },
]

const knowledgeTransferOptions: SelectProps.Option[] = [
  { label: 'Full docs + devs', value: '100', description: 'Full documentation and original developers available' },
  { label: 'Key person', value: '75', description: 'Key person available' },
  { label: 'Docs only', value: '50', description: 'Documentation only, no developers' },
  { label: 'None', value: '0', description: 'No knowledge transfer available' },
]

const trainingCompletedOptions: SelectProps.Option[] = [
  { label: 'All trained', value: '100', description: 'All team members trained' },
  { label: 'Some trained', value: '50', description: 'Some team members trained' },
  { label: 'No training', value: '0', description: 'No training completed' },
]

// Business Readiness Options (matching migration-application-score.md)
const maintenanceWindowOptions: SelectProps.Option[] = [
  { label: 'Flexible', value: '100', description: 'Flexible maintenance window available' },
  { label: 'Limited', value: '50', description: 'Limited maintenance windows' },
  { label: 'No downtime', value: '0', description: 'No downtime allowed' },
]

const businessCalendarOptions: SelectProps.Option[] = [
  { label: 'Off-peak', value: '100', description: 'Off-peak season' },
  { label: 'Normal', value: '50', description: 'Normal business period' },
  { label: 'Peak season', value: '0', description: 'Peak business season' },
]

const stakeholderAlignmentOptions: SelectProps.Option[] = [
  { label: 'Full buy-in', value: '100', description: 'Full stakeholder buy-in' },
  { label: 'Some concerns', value: '50', description: 'Some stakeholder concerns' },
  { label: 'Strong resistance', value: '0', description: 'Strong stakeholder resistance' },
]

const budgetAvailabilityOptions: SelectProps.Option[] = [
  { label: 'Fully funded', value: '100', description: 'Fully funded' },
  { label: 'Partial', value: '50', description: 'Partial funding available' },
  { label: 'No budget', value: '0', description: 'No budget allocated' },
]

export default function ReadinessInputWizard({ visible, onDismiss, onSubmit }: ReadinessInputWizardProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  // Team Readiness State
  const [teamAvailability, setTeamAvailability] = useState<SelectProps.Option | null>(null)
  const [skillLevel, setSkillLevel] = useState<SelectProps.Option | null>(null)
  const [knowledgeTransfer, setKnowledgeTransfer] = useState<SelectProps.Option | null>(null)
  const [trainingCompleted, setTrainingCompleted] = useState<SelectProps.Option | null>(null)

  // Business Readiness State
  const [maintenanceWindow, setMaintenanceWindow] = useState<SelectProps.Option | null>(null)
  const [businessCalendar, setBusinessCalendar] = useState<SelectProps.Option | null>(null)
  const [stakeholderAlignment, setStakeholderAlignment] = useState<SelectProps.Option | null>(null)
  const [budgetAvailability, setBudgetAvailability] = useState<SelectProps.Option | null>(null)

  // Validation error state
  const [showStep1Errors, setShowStep1Errors] = useState(false)
  const [showStep2Errors, setShowStep2Errors] = useState(false)

  // Calculate Team Readiness Score (weighted)
  const calculateTeamReadinessScore = (): number => {
    if (!teamAvailability || !skillLevel || !knowledgeTransfer || !trainingCompleted) {
      return 0
    }

    const availability = parseFloat(teamAvailability.value || '0') * 0.30
    const skill = parseFloat(skillLevel.value || '0') * 0.30
    const knowledge = parseFloat(knowledgeTransfer.value || '0') * 0.25
    const training = parseFloat(trainingCompleted.value || '0') * 0.15

    return Math.round(availability + skill + knowledge + training)
  }

  // Calculate Business Readiness Score (weighted)
  const calculateBusinessReadinessScore = (): number => {
    if (!maintenanceWindow || !businessCalendar || !stakeholderAlignment || !budgetAvailability) {
      return 0
    }

    const maintenance = parseFloat(maintenanceWindow.value || '0') * 0.25
    const calendar = parseFloat(businessCalendar.value || '0') * 0.25
    const stakeholder = parseFloat(stakeholderAlignment.value || '0') * 0.25
    const budget = parseFloat(budgetAvailability.value || '0') * 0.25

    return Math.round(maintenance + calendar + stakeholder + budget)
  }

  const handleSubmit = () => {
    const inputs: ReadinessInputs = {
      team: {
        teamAvailability: parseFloat(teamAvailability?.value || '0'),
        skillLevel: parseFloat(skillLevel?.value || '0'),
        knowledgeTransfer: parseFloat(knowledgeTransfer?.value || '0'),
        trainingCompleted: parseFloat(trainingCompleted?.value || '0'),
      },
      business: {
        maintenanceWindow: parseFloat(maintenanceWindow?.value || '0'),
        businessCalendar: parseFloat(businessCalendar?.value || '0'),
        stakeholderAlignment: parseFloat(stakeholderAlignment?.value || '0'),
        budgetAvailability: parseFloat(budgetAvailability?.value || '0'),
      },
    }

    onSubmit(inputs)
    handleCancel()
  }

  const handleCancel = () => {
    // Reset all state
    setActiveStepIndex(0)
    setTeamAvailability(null)
    setSkillLevel(null)
    setKnowledgeTransfer(null)
    setTrainingCompleted(null)
    setMaintenanceWindow(null)
    setBusinessCalendar(null)
    setStakeholderAlignment(null)
    setBudgetAvailability(null)
    setShowStep1Errors(false)
    setShowStep2Errors(false)
    onDismiss()
  }

  const isStep1Valid = (): boolean => {
    return !!(teamAvailability && skillLevel && knowledgeTransfer && trainingCompleted)
  }

  const isStep2Valid = (): boolean => {
    return !!(maintenanceWindow && businessCalendar && stakeholderAlignment && budgetAvailability)
  }

  if (!visible) return null

  return (
    <Modal
      visible={visible}
      onDismiss={handleCancel}
      header="Application Readiness Assessment"
      size="large"
    >
      <Wizard
      i18nStrings={{
        stepNumberLabel: (stepNumber) => `Step ${stepNumber}`,
        collapsedStepsLabel: (stepNumber, stepsCount) => `Step ${stepNumber} of ${stepsCount}`,
        skipToButtonLabel: (step) => `Skip to ${step.title}`,
        navigationAriaLabel: 'Steps',
        cancelButton: 'Cancel',
        previousButton: 'Previous',
        nextButton: 'Next',
        submitButton: 'Submit',
        optional: 'optional',
      }}
      onNavigate={({ detail }) => {
        const requestedStep = detail.requestedStepIndex
        // Validate current step before allowing navigation forward
        if (requestedStep > activeStepIndex) {
          if (activeStepIndex === 0 && !isStep1Valid()) {
            setShowStep1Errors(true)
            return // Prevent navigation if step 1 is invalid
          }
          if (activeStepIndex === 1 && !isStep2Valid()) {
            setShowStep2Errors(true)
            return // Prevent navigation if step 2 is invalid
          }
        }
        // Reset error states when navigating
        setShowStep1Errors(false)
        setShowStep2Errors(false)
        setActiveStepIndex(requestedStep)
      }}
      onCancel={handleCancel}
      onSubmit={handleSubmit}
      activeStepIndex={activeStepIndex}
      steps={[
        {
          title: 'Team Readiness Input',
          description: 'Provide information about team availability and capabilities',
          content: (
            <Container>
              <SpaceBetween size="l">
                <Alert type="info">
                  Select the appropriate values for each team readiness factor. The calculated score will be displayed in real-time.
                </Alert>

                {showStep1Errors && !isStep1Valid() && (
                  <Alert type="error" header="Required fields missing">
                    Please select values for all team readiness fields before proceeding to the next step.
                  </Alert>
                )}

                <SpaceBetween size="m">
                  <FormField
                    label="Team Availability"
                    description="Is there a dedicated team available for this migration?"
                    errorText={showStep1Errors && !teamAvailability ? 'Team availability is required' : undefined}
                  >
                    <Select
                      selectedOption={teamAvailability}
                      onChange={({ detail }) => setTeamAvailability(detail.selectedOption)}
                      options={teamAvailabilityOptions}
                      placeholder="Select team availability"
                      selectedAriaLabel="Selected"
                      invalid={showStep1Errors && !teamAvailability}
                    />
                  </FormField>

                  <FormField
                    label="Skill Level"
                    description="What is the team's experience level with the target platform?"
                    errorText={showStep1Errors && !skillLevel ? 'Skill level is required' : undefined}
                  >
                    <Select
                      selectedOption={skillLevel}
                      onChange={({ detail }) => setSkillLevel(detail.selectedOption)}
                      options={skillLevelOptions}
                      placeholder="Select skill level"
                      selectedAriaLabel="Selected"
                      invalid={showStep1Errors && !skillLevel}
                    />
                  </FormField>

                  <FormField
                    label="Knowledge Transfer"
                    description="What knowledge transfer resources are available?"
                    errorText={showStep1Errors && !knowledgeTransfer ? 'Knowledge transfer status is required' : undefined}
                  >
                    <Select
                      selectedOption={knowledgeTransfer}
                      onChange={({ detail }) => setKnowledgeTransfer(detail.selectedOption)}
                      options={knowledgeTransferOptions}
                      placeholder="Select knowledge transfer status"
                      selectedAriaLabel="Selected"
                      invalid={showStep1Errors && !knowledgeTransfer}
                    />
                  </FormField>

                  <FormField
                    label="Training Completed"
                    description="Has the team completed necessary training?"
                    errorText={showStep1Errors && !trainingCompleted ? 'Training status is required' : undefined}
                  >
                    <Select
                      selectedOption={trainingCompleted}
                      onChange={({ detail }) => setTrainingCompleted(detail.selectedOption)}
                      options={trainingCompletedOptions}
                      placeholder="Select training status"
                      selectedAriaLabel="Selected"
                      invalid={showStep1Errors && !trainingCompleted}
                    />
                  </FormField>
                </SpaceBetween>

                {isStep1Valid() && (
                  <Box variant="awsui-key-label">
                    <SpaceBetween size="xs">
                      <div>
                        <Box variant="awsui-key-label">Calculated Team Readiness Score</Box>
                        <Box fontSize="heading-xl" fontWeight="bold" color="text-status-info">
                          {calculateTeamReadinessScore()} / 100
                        </Box>
                      </div>
                      <Box variant="small" color="text-body-secondary">
                        Weighted: Team Availability (30%), Skill Level (30%), Knowledge Transfer (25%), Training (15%)
                      </Box>
                    </SpaceBetween>
                  </Box>
                )}
              </SpaceBetween>
            </Container>
          ),
          isOptional: false,
        },
        {
          title: 'Business Readiness Input',
          description: 'Provide information about business constraints and readiness',
          content: (
            <Container>
              <SpaceBetween size="l">
                <Alert type="info">
                  Select the appropriate values for each business readiness factor. The calculated score will be displayed in real-time.
                </Alert>

                {showStep2Errors && !isStep2Valid() && (
                  <Alert type="error" header="Required fields missing">
                    Please select values for all business readiness fields before proceeding to the next step.
                  </Alert>
                )}

                <SpaceBetween size="m">
                  <FormField
                    label="Maintenance Window"
                    description="What maintenance window availability exists?"
                    errorText={showStep2Errors && !maintenanceWindow ? 'Maintenance window is required' : undefined}
                  >
                    <Select
                      selectedOption={maintenanceWindow}
                      onChange={({ detail }) => setMaintenanceWindow(detail.selectedOption)}
                      options={maintenanceWindowOptions}
                      placeholder="Select maintenance window"
                      selectedAriaLabel="Selected"
                      invalid={showStep2Errors && !maintenanceWindow}
                    />
                  </FormField>

                  <FormField
                    label="Business Calendar"
                    description="What is the current business calendar status?"
                    errorText={showStep2Errors && !businessCalendar ? 'Business calendar status is required' : undefined}
                  >
                    <Select
                      selectedOption={businessCalendar}
                      onChange={({ detail }) => setBusinessCalendar(detail.selectedOption)}
                      options={businessCalendarOptions}
                      placeholder="Select business calendar status"
                      selectedAriaLabel="Selected"
                      invalid={showStep2Errors && !businessCalendar}
                    />
                  </FormField>

                  <FormField
                    label="Stakeholder Alignment"
                    description="What is the level of stakeholder buy-in?"
                    errorText={showStep2Errors && !stakeholderAlignment ? 'Stakeholder alignment is required' : undefined}
                  >
                    <Select
                      selectedOption={stakeholderAlignment}
                      onChange={({ detail }) => setStakeholderAlignment(detail.selectedOption)}
                      options={stakeholderAlignmentOptions}
                      placeholder="Select stakeholder alignment"
                      selectedAriaLabel="Selected"
                      invalid={showStep2Errors && !stakeholderAlignment}
                    />
                  </FormField>

                  <FormField
                    label="Budget Availability"
                    description="Is budget allocated for this migration?"
                    errorText={showStep2Errors && !budgetAvailability ? 'Budget availability is required' : undefined}
                  >
                    <Select
                      selectedOption={budgetAvailability}
                      onChange={({ detail }) => setBudgetAvailability(detail.selectedOption)}
                      options={budgetAvailabilityOptions}
                      placeholder="Select budget availability"
                      selectedAriaLabel="Selected"
                      invalid={showStep2Errors && !budgetAvailability}
                    />
                  </FormField>
                </SpaceBetween>

                {isStep2Valid() && (
                  <Box variant="awsui-key-label">
                    <SpaceBetween size="xs">
                      <div>
                        <Box variant="awsui-key-label">Calculated Business Readiness Score</Box>
                        <Box fontSize="heading-xl" fontWeight="bold" color="text-status-info">
                          {calculateBusinessReadinessScore()} / 100
                        </Box>
                      </div>
                      <Box variant="small" color="text-body-secondary">
                        Weighted: Maintenance Window (25%), Business Calendar (25%), Stakeholder Alignment (25%), Budget (25%)
                      </Box>
                    </SpaceBetween>
                  </Box>
                )}
              </SpaceBetween>
            </Container>
          ),
          isOptional: false,
        },
        {
          title: 'Review & Confirm',
          description: 'Review your selections and calculated scores',
          content: (
            <Container>
              <SpaceBetween size="l">
                <Alert type="success">
                  Review your selections below. You can go back to previous steps to make changes if needed.
                </Alert>

                <ColumnLayout columns={2} variant="text-grid">
                  <SpaceBetween size="l">
                    <div>
                      <Box variant="h3">Team Readiness</Box>
                      <SpaceBetween size="s">
                        <div>
                          <Box variant="awsui-key-label">Team Availability</Box>
                          <div>{teamAvailability?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Skill Level</Box>
                          <div>{skillLevel?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Knowledge Transfer</Box>
                          <div>{knowledgeTransfer?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Training Completed</Box>
                          <div>{trainingCompleted?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Team Readiness Score</Box>
                          <Box fontSize="heading-l" fontWeight="bold" color="text-status-info">
                            {calculateTeamReadinessScore()} / 100
                          </Box>
                        </div>
                      </SpaceBetween>
                    </div>
                  </SpaceBetween>

                  <SpaceBetween size="l">
                    <div>
                      <Box variant="h3">Business Readiness</Box>
                      <SpaceBetween size="s">
                        <div>
                          <Box variant="awsui-key-label">Maintenance Window</Box>
                          <div>{maintenanceWindow?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Business Calendar</Box>
                          <div>{businessCalendar?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Stakeholder Alignment</Box>
                          <div>{stakeholderAlignment?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Budget Availability</Box>
                          <div>{budgetAvailability?.label || 'Not selected'}</div>
                        </div>
                        <div>
                          <Box variant="awsui-key-label">Business Readiness Score</Box>
                          <Box fontSize="heading-l" fontWeight="bold" color="text-status-info">
                            {calculateBusinessReadinessScore()} / 100
                          </Box>
                        </div>
                      </SpaceBetween>
                    </div>
                  </SpaceBetween>
                </ColumnLayout>
              </SpaceBetween>
            </Container>
          ),
        },
      ]}
    />
    </Modal>
  )
}
