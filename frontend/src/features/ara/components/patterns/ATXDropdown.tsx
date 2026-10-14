import { useState, useEffect } from 'react'
import { Select, FormField, Box } from '@cloudscape-design/components'
import { ATXTransformation } from '../../services/patterns'

interface ATXDropdownProps {
  patternId: string
  applicationId: string
  applicationName: string
  strategy: string
  transformationInstructions: string
  atxTransformations: ATXTransformation[]
  onSelect: (mapping: {
    pattern_id: string
    application_id: string
    application_name: string
    strategy: string
    transformation_instructions: string
    atx_name: string
    atx_description: string
  }) => void
  disabled?: boolean
  errorText?: string
  initialValue?: string
}

export default function ATXDropdown({
  patternId,
  applicationId,
  applicationName,
  strategy,
  transformationInstructions,
  atxTransformations,
  onSelect,
  disabled = false,
  errorText,
  initialValue,
}: ATXDropdownProps) {
  const [selectedOption, setSelectedOption] = useState<{
    label?: string
    value?: string
  } | null>(null)

  // Convert ATX transformations to select options - simple format
  const options = atxTransformations.map((atx) => ({
    label: atx.name,
    value: atx.name,
  }))

  // Set initial value when component mounts or initialValue changes
  useEffect(() => {
    if (initialValue && options.length > 0) {
      const option = options.find(opt => opt.value === initialValue)
      if (option) {
        setSelectedOption(option)
      }
    }
  }, [initialValue, atxTransformations])

  const handleChange = (detail: { selectedOption: { label?: string; value?: string } }) => {
    const option = detail.selectedOption
    setSelectedOption(option)

    if (option?.value) {
      const atx = atxTransformations.find((t) => t.name === option.value)
      if (atx) {
        onSelect({
          pattern_id: patternId,
          application_id: applicationId,
          application_name: applicationName,
          strategy: strategy,
          transformation_instructions: transformationInstructions,
          atx_name: atx.name,
          atx_description: atx.description,
        })
      }
    }
  }

  // Get description for selected option
  const selectedDescription = selectedOption?.value
    ? atxTransformations.find(t => t.name === selectedOption.value)?.description
    : null

  return (
    <FormField
      label="ATX Transformation"
      description="Select the AWS Transformation Executor definition for this application"
      errorText={errorText}
    >
      <Select
        selectedOption={selectedOption}
        onChange={({ detail }) => handleChange(detail)}
        options={options}
        placeholder="Select ATX transformation"
        disabled={disabled}
        selectedAriaLabel="Selected"
        ariaLabel="ATX Transformation"
        expandToViewport={true}
      />
      {selectedDescription && (
        <Box variant="small" color="text-body-secondary" margin={{ top: 'xs' }}>
          {selectedDescription}
        </Box>
      )}
    </FormField>
  )
}
