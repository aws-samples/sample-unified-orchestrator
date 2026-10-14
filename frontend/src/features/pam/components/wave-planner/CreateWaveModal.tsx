import { useState } from 'react'
import { Modal, Box, Button, FormField, Input, Textarea, SpaceBetween, Alert, DatePicker } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function CreateWaveModal({ onClose, onSuccess }: Props) {
  const [waveName, setWaveName] = useState('')
  const [description, setDescription] = useState('')
  const [targetStartDate, setTargetStartDate] = useState('')
  const [targetEndDate, setTargetEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setError('')

    if (!waveName.trim()) {
      setError('Wave name is required')
      return
    }

    try {
      setLoading(true)
      await dualApiClient('/api/waves', {
        backend: 'migration-refinery',
        method: 'POST',
        body: {
          waveName: waveName.trim(),
          description: description.trim() || null,
          targetStartDate: targetStartDate || null,
          targetEndDate: targetEndDate || null
        }
      })
      onSuccess()
    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to create wave'
      setError(errorMsg)
      console.error('Failed to create wave:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onDismiss={onClose}
      visible={true}
      header="Create New Wave"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} loading={loading} disabled={!waveName.trim()}>
              Create Wave
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {error && <Alert type="error">{error}</Alert>}

        <FormField label="Wave Name" description="Required">
          <Input
            value={waveName}
            onChange={({ detail }) => setWaveName(detail.value)}
            placeholder="e.g., Wave 1 - Java Modernization"
            disabled={loading}
          />
        </FormField>

        <FormField label="Description">
          <Textarea
            value={description}
            onChange={({ detail }) => setDescription(detail.value)}
            placeholder="Optional description..."
            disabled={loading}
          />
        </FormField>

        <SpaceBetween direction="horizontal" size="m">
          <FormField label="Target Start Date">
            <DatePicker
              value={targetStartDate}
              onChange={({ detail }) => setTargetStartDate(detail.value)}
              disabled={loading}
              placeholder="YYYY/MM/DD"
            />
          </FormField>

          <FormField label="Target End Date">
            <DatePicker
              value={targetEndDate}
              onChange={({ detail }) => setTargetEndDate(detail.value)}
              disabled={loading}
              placeholder="YYYY/MM/DD"
            />
          </FormField>
        </SpaceBetween>
      </SpaceBetween>
    </Modal>
  )
}
