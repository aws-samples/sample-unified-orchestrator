import { useState, useEffect } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Table,
  Box,
  Button,
  Alert,
  Spinner,
  ExpandableSection,
  StatusIndicator,
  Modal,
  ButtonDropdown,
} from '@cloudscape-design/components'
import {
  Pattern,
  ATXTransformation,
  ATXMapping,
  getATXTransformations,
  getATXMappings,
  submitATXMappings,
} from '../../services/patterns'
import {
  clearATXMapping,
  resetCompletedApplication,
  bulkClearATXMappings,
  bulkMarkComplete,
  bulkResetApplications,
} from '../../services/applications'
import ATXDropdown from './ATXDropdown'
import StatusBadge from '../../../uno/components/common/StatusBadge'

interface ATXMappingPanelProps {
  waveId: string
  patterns: Pattern[]
  onMappingsSubmitted?: () => void
}

export default function ATXMappingPanel({ waveId, patterns, onMappingsSubmitted }: ATXMappingPanelProps) {
  const [atxTransformations, setAtxTransformations] = useState<ATXTransformation[]>([])
  const [mappings, setMappings] = useState<Map<string, ATXMapping>>(new Map())
  const [selectedItems, setSelectedItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Map<string, string>>(new Map())
  const [confirmModal, setConfirmModal] = useState<{
    visible: boolean
    action: string
    message: string
    onConfirm: () => void
  } | null>(null)

  // Load ATX transformations on mount
  useEffect(() => {
    loadATXTransformations()
    loadExistingMappings()
  }, [waveId])

  const loadATXTransformations = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getATXTransformations()
      if (response.success) {
        setAtxTransformations(response.transformations)
      } else {
        setError(response.error || 'Failed to load ATX transformations')
      }
    } catch (err: any) {
      console.error('Error loading ATX transformations:', err)
      setError(err.response?.data?.error || err.message || 'Failed to load ATX transformations')
    } finally {
      setLoading(false)
    }
  }

  const loadExistingMappings = async () => {
    try {
      const response = await getATXMappings(waveId)
      if (response.success && response.mappings.length > 0) {
        const existingMappings = new Map<string, ATXMapping>()
        response.mappings.forEach((mapping) => {
          const key = `${mapping.pattern_id}-${mapping.application_id}`
          existingMappings.set(key, mapping)
        })
        setMappings(existingMappings)
      }
    } catch (err: any) {
      console.error('Error loading existing mappings:', err)
      // Don't show error to user - just log it
    }
  }

  const handleMappingSelect = (mapping: ATXMapping) => {
    const key = `${mapping.pattern_id}-${mapping.application_id}`
    setMappings(new Map(mappings.set(key, mapping)))
    // Clear validation error for this mapping
    if (validationErrors.has(key)) {
      const newErrors = new Map(validationErrors)
      newErrors.delete(key)
      setValidationErrors(newErrors)
    }
    // Clear success message when user makes changes
    if (success) {
      setSuccess(null)
    }
  }

  const validateMappings = (): boolean => {
    // No validation needed - user can select any number of applications
    // Just check that at least one mapping exists
    if (mappings.size === 0) {
      setError('Please select at least one ATX transformation to submit')
      return false
    }
    return true
  }

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)

    // Validate - just need at least one mapping
    if (!validateMappings()) {
      return
    }

    setSubmitting(true)

    try {
      const mappingsArray = Array.from(mappings.values())
      const response = await submitATXMappings(waveId, mappingsArray)

      if (response.success) {
        setSuccess(
          response.message || `Successfully updated ${response.updated_count} ATX mappings`
        )
        // Clear mappings after successful submission
        setMappings(new Map())
        setValidationErrors(new Map())

        // Notify parent component
        if (onMappingsSubmitted) {
          onMappingsSubmitted()
        }
      } else {
        setError(response.error || 'Failed to submit ATX mappings')
        if (response.errors && response.errors.length > 0) {
          setError(`${response.error}\n\nErrors:\n${response.errors.join('\n')}`)
        }
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || 'Failed to submit ATX mappings'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleClearATX = async (applicationId: string) => {
    setConfirmModal({
      visible: true,
      action: 'Clear ATX Mapping',
      message: 'This will clear the ATX mapping and reset the wave analysis status. The application will be included in the next wave analysis.',
      onConfirm: async () => {
        try {
          await clearATXMapping(applicationId)
          setSuccess('ATX mapping cleared successfully')
          if (onMappingsSubmitted) {
            onMappingsSubmitted()
          }
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to clear ATX mapping')
        } finally {
          setConfirmModal(null)
        }
      }
    })
  }

  const handleMarkComplete = async (applicationId: string) => {
    setConfirmModal({
      visible: true,
      action: 'Mark as Complete',
      message: 'This will mark the application as complete. It will be excluded from future wave analysis and ATX mapping.',
      onConfirm: async () => {
        try {
          await resetCompletedApplication(applicationId)
          setSuccess('Application marked as complete')
          if (onMappingsSubmitted) {
            onMappingsSubmitted()
          }
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to mark as complete')
        } finally {
          setConfirmModal(null)
        }
      }
    })
  }

  const handleBulkClearATX = async () => {
    const appIds = selectedItems.map(item => item.app_id)
    setConfirmModal({
      visible: true,
      action: 'Bulk Clear ATX Mappings',
      message: `Clear ATX mappings for ${appIds.length} selected application(s)? This will reset their wave analysis status.`,
      onConfirm: async () => {
        try {
          const result = await bulkClearATXMappings(appIds)
          setSuccess(`Cleared ${result.success_count} ATX mappings`)
          setSelectedItems([])
          if (onMappingsSubmitted) {
            onMappingsSubmitted()
          }
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to clear ATX mappings')
        } finally {
          setConfirmModal(null)
        }
      }
    })
  }

  const handleBulkMarkComplete = async () => {
    const appIds = selectedItems.map(item => item.app_id)
    setConfirmModal({
      visible: true,
      action: 'Bulk Mark as Complete',
      message: `Mark ${appIds.length} selected application(s) as complete?`,
      onConfirm: async () => {
        try {
          const result = await bulkMarkComplete(appIds)
          setSuccess(`Marked ${result.success_count} applications as complete`)
          setSelectedItems([])
          if (onMappingsSubmitted) {
            onMappingsSubmitted()
          }
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to mark as complete')
        } finally {
          setConfirmModal(null)
        }
      }
    })
  }

  const handleBulkReset = async () => {
    const appIds = selectedItems.map(item => item.app_id)
    setConfirmModal({
      visible: true,
      action: 'Bulk Reset Applications',
      message: `Reset ${appIds.length} selected application(s)? This will allow them to be re-analyzed.`,
      onConfirm: async () => {
        try {
          const result = await bulkResetApplications(appIds)
          setSuccess(`Reset ${result.success_count} applications`)
          setSelectedItems([])
          if (onMappingsSubmitted) {
            onMappingsSubmitted()
          }
        } catch (err: any) {
          setError(err.response?.data?.error || 'Failed to reset applications')
        } finally {
          setConfirmModal(null)
        }
      }
    })
  }

  const getTotalApplications = () => {
    return patterns.reduce((sum, pattern) => sum + pattern.applications.length, 0)
  }

  const getMappedCount = () => {
    return mappings.size
  }

  // If no ATX file uploaded, show warning
  if (!loading && atxTransformations.length === 0) {
    return (
      <Container
        header={
          <Header variant="h2" description="Map patterns to ATX transformation definitions">
            ATX Transformation Mapping
          </Header>
        }
      >
        <Alert
          type="warning"
          header="No ATX file uploaded"
          action={
            <Button iconName="upload" onClick={loadATXTransformations}>
              Retry
            </Button>
          }
        >
          Please upload an ATX transformation file in the Notes section before mapping patterns.
          <Box variant="p" margin={{ top: 's' }}>
            Go to Notes → Upload → Select file type "ATX" → Upload your ATX JSON file
          </Box>
        </Alert>
      </Container>
    )
  }

  // If loading, show spinner
  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
          <Box variant="p" padding={{ top: 's' }}>
            Loading ATX transformations...
          </Box>
        </Box>
      </Container>
    )
  }

  // If no patterns, show info
  if (patterns.length === 0) {
    return (
      <Container
        header={
          <Header variant="h2">
            ATX Transformation Mapping
          </Header>
        }
      >
        <Alert type="info">
          No patterns available for mapping. Please run application pattern analysis first.
        </Alert>
      </Container>
    )
  }

  return (
    <>
      <Container
        header={
          <Header
            variant="h2"
            description="Map each application to an ATX transformation definition"
            info={
              <Box variant="p">
                Select an ATX transformation for each application. The transformation will be used
                to automate the migration process.
              </Box>
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {selectedItems.length > 0 && (
                  <ButtonDropdown
                    items={[
                      { id: 'clear', text: 'Clear ATX Mappings' },
                      { id: 'complete', text: 'Mark as Complete' },
                      { id: 'reset', text: 'Reset to Not Started' },
                    ]}
                    onItemClick={({ detail }) => {
                      if (detail.id === 'clear') handleBulkClearATX()
                      else if (detail.id === 'complete') handleBulkMarkComplete()
                      else if (detail.id === 'reset') handleBulkReset()
                    }}
                  >
                    Bulk Actions ({selectedItems.length})
                  </ButtonDropdown>
                )}
                <StatusIndicator type={getMappedCount() === getTotalApplications() ? 'success' : 'pending'}>
                  {getMappedCount()} of {getTotalApplications()} mapped
                </StatusIndicator>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={submitting || getMappedCount() === 0}
                  loading={submitting}
                >
                  Submit Mappings
                </Button>
              </SpaceBetween>
            }
          >
            ATX Transformation Mapping
          </Header>
        }
      >
        <SpaceBetween size="l">
          {error && (
            <Alert
              type="error"
              dismissible
              onDismiss={() => setError(null)}
              header="Error"
            >
              {error}
            </Alert>
          )}

          {success && (
            <Alert
              type="success"
              dismissible
              onDismiss={() => setSuccess(null)}
              header="Success"
            >
              {success}
            </Alert>
          )}

          <Box variant="p" color="text-body-secondary">
            {atxTransformations.length} ATX transformations available • Showing applications with wave_analysis_status = COMPLETED
          </Box>

          {patterns.map((pattern) => (
            <ExpandableSection
              key={pattern.pattern_id}
              headerText={pattern.human_name}
              headerDescription={`${pattern.application_count} application(s) • ${pattern.migration_strategy}`}
              defaultExpanded={true}
            >
              <SpaceBetween size="m">
                <Box variant="small" color="text-body-secondary">
                  {pattern.description}
                </Box>

                <Table
                  columnDefinitions={[
                    {
                      id: 'app_name',
                      header: 'Application',
                      cell: (item) => (
                        <Box>
                          <Box variant="strong">{item.app_name}</Box>
                          <Box variant="small" color="text-body-secondary">
                            {item.change_count} change(s) • {item.total_components} component(s)
                          </Box>
                        </Box>
                      ),
                      width: 250,
                    },
                    {
                      id: 'status',
                      header: 'ATX Status',
                      cell: (item) => (
                        <StatusBadge field="atx_mapping" status={item.atx_mapping_status || 'NOT_MAPPED'} />
                      ),
                      width: 150,
                    },
                    {
                      id: 'atx_mapping',
                      header: 'ATX Transformation',
                      cell: (item) => {
                        const key = `${pattern.pattern_id}-${item.app_id}`
                        const existingMapping = mappings.get(key)
                        return (
                          <ATXDropdown
                            patternId={pattern.pattern_id}
                            applicationId={item.app_id}
                            applicationName={item.app_name}
                            strategy={pattern.migration_strategy}
                            transformationInstructions={pattern.description || ''}
                            atxTransformations={atxTransformations}
                            onSelect={handleMappingSelect}
                            disabled={submitting}
                            errorText={validationErrors.get(key)}
                            initialValue={existingMapping?.atx_name}
                          />
                        )
                      },
                      minWidth: 350,
                    },
                    {
                      id: 'actions',
                      header: 'Actions',
                      cell: (item) => (
                        <ButtonDropdown
                          items={[
                            { id: 'clear', text: 'Clear ATX', disabled: !item.atx_mapping_status || item.atx_mapping_status === 'NOT_MAPPED' },
                            { id: 'complete', text: 'Mark as Complete', disabled: item.atx_mapping_status !== 'MAPPED' },
                            { id: 'reset', text: 'Reset', disabled: item.atx_mapping_status !== 'COMPLETED' },
                          ]}
                          onItemClick={({ detail }) => {
                            if (detail.id === 'clear') handleClearATX(item.app_id)
                            else if (detail.id === 'complete') handleMarkComplete(item.app_id)
                            else if (detail.id === 'reset') handleMarkComplete(item.app_id)
                          }}
                          variant="icon"
                        />
                      ),
                      width: 100,
                    },
                  ]}
                  items={pattern.applications}
                  selectionType="multi"
                  selectedItems={selectedItems}
                  onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
                  variant="embedded"
                  empty={
                    <Box textAlign="center" color="inherit">
                      No applications
                    </Box>
                  }
                />
              </SpaceBetween>
            </ExpandableSection>
          ))}
        </SpaceBetween>
      </Container>

      {confirmModal && (
        <Modal
          visible={confirmModal.visible}
          onDismiss={() => setConfirmModal(null)}
          header={confirmModal.action}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setConfirmModal(null)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={confirmModal.onConfirm}>
                  Confirm
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          {confirmModal.message}
        </Modal>
      )}
    </>
  )
}
