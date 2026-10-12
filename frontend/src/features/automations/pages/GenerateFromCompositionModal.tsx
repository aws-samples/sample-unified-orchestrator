import { useEffect, useState } from 'react'
import {
  Modal,
  Box,
  SpaceBetween,
  Button,
  FormField,
  Select,
  Alert,
} from '@cloudscape-design/components'
import RuntimeValuesForm from './iac-agent/RuntimeValuesForm'
import { iacAgentApi } from '../services/iacAgent'
import { extractApiError } from '../utils/extractApiError'

interface GenerateFromCompositionModalProps {
  visible: boolean
  motsId: string
  availableEnvironments: string[]
  onDismiss: () => void
  onGenerated: (motsId: string, environment: string) => void
}

type ModalStep = 'select_environment' | 'edit_runtime_values'

export default function GenerateFromCompositionModal({
  visible, motsId, availableEnvironments, onDismiss, onGenerated,
}: GenerateFromCompositionModalProps) {
  const [step, setStep] = useState<ModalStep>('select_environment')
  const [environment, setEnvironment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [allEnvironments, setAllEnvironments] = useState<{ label: string; value: string; description?: string }[]>([])
  const [envLoading, setEnvLoading] = useState(true)

  useEffect(() => {
    setEnvLoading(true)
    iacAgentApi.getEnvironments().then(({ data }) => {
      const options = data.environment_classes.flatMap((ec) =>
        ec.sub_environments.map((se) => ({
          label: se.label,
          value: se.name,
          description: ec.label,
        }))
      )
      setAllEnvironments(options)
    }).catch((err) => {
      setError(extractApiError(err, 'Failed to load environments'))
    }).finally(() => {
      setEnvLoading(false)
    })
  }, [])

  const handleDismiss = () => { setStep('select_environment'); setEnvironment(''); setError(null); onDismiss() }
  const handleEnvironmentNext = () => { if (!environment) return; setStep('edit_runtime_values') }

  // Navigate to Composer page after saving runtime values.
  // Generation is handled exclusively by GenerateConfirmPanel on the Composer page
  // to avoid dual step function invocations (modal + confirm panel).
  const handleRuntimeValuesComplete = () => {
    handleDismiss()
    onGenerated(motsId, environment)
  }

  const envOptions = allEnvironments.map((e) => ({
    ...e,
    description: availableEnvironments.includes(e.value) ? 'Runtime values configured' : e.description,
  }))

  return (
    <Modal
      visible={visible}
      onDismiss={handleDismiss}
      size="large"
      header={`Generate — ${motsId}`}
      footer={
        step === 'select_environment' ? (
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={handleDismiss}>Cancel</Button>
              <Button variant="primary" disabled={!environment} onClick={handleEnvironmentNext}>Next</Button>
            </SpaceBetween>
          </Box>
        ) : undefined
      }
    >
      {error && <Alert type="error" dismissible onDismiss={() => setError(null)}>{error}</Alert>}
      {step === 'select_environment' && (
        <FormField label="Target Environment" description="Select the environment to generate Terraform code for">
          <Select
            selectedOption={envOptions.find((o) => o.value === environment) ?? null}
            onChange={({ detail }) => setEnvironment(detail.selectedOption.value ?? '')}
            options={envOptions}
            placeholder="Select environment"
            loadingText="Loading environments..."
            statusType={envLoading ? 'loading' : undefined}
            empty="No environments available"
          />
        </FormField>
      )}
      {step === 'edit_runtime_values' && (
        <RuntimeValuesForm motsId={motsId} environment={environment} onComplete={handleRuntimeValuesComplete} />
      )}
    </Modal>
  )
}
