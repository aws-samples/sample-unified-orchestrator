import { useEffect, useState } from 'react'
import { Modal, Box, Spinner, Alert } from '@cloudscape-design/components'
import { iacAgentApi } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'

interface RuntimeValuesModalProps {
  visible: boolean
  motsId: string
  environment: string
  onDismiss: () => void
}

export default function RuntimeValuesModal({ visible, motsId, environment, onDismiss }: RuntimeValuesModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!visible) return
    setLoading(true)
    setError(null)
    setValues(null)

    iacAgentApi
      .getRuntimeValues(motsId, environment)
      .then((res) => setValues(res.data))
      .catch((err) => setError(extractApiError(err, 'Failed to load runtime values')))
      .finally(() => setLoading(false))
  }, [visible, motsId, environment])

  return (
    <Modal visible={visible} onDismiss={onDismiss} size="large" header={`Runtime Values — ${environment}`}>
      {loading && (
        <Box textAlign="center" padding="l">
          <Spinner /> Loading…
        </Box>
      )}
      {error && <Alert type="error">{error}</Alert>}
      {values && <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(values, null, 2)}</pre>}
    </Modal>
  )
}
