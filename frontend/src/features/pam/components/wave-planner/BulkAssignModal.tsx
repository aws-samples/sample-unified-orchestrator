import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { dualApiClient } from '../../api/dualApiClient'
import { Button } from '../ui/button'

interface Wave {
  waveId: number
  waveName: string
  status: string
}

interface Props {
  motsIds: number[]
  waves: Wave[]
  onClose: () => void
  onSuccess: () => void
}

export default function BulkAssignModal({ motsIds, waves, onClose, onSuccess }: Props) {
  const [selectedWaveId, setSelectedWaveId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAssign = async () => {
    if (!selectedWaveId) {
      setError('Please select a wave')
      return
    }

    try {
      setLoading(true)
      setError('')

      await dualApiClient(`/api/waves/${selectedWaveId}/applications`, {
        backend: 'migration-refinery',
        method: 'POST',
        body: { motsIds }
      })

      onSuccess()
    } catch (err) {
      setError('Failed to assign applications. Some may already be assigned.')
      console.error('Bulk assign failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            Assign {motsIds.length} Applications
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
            disabled={loading}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Target Wave
            </label>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {waves.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  No proposed waves available. Create a wave first.
                </div>
              ) : (
                waves.map(wave => (
                  <label
                    key={wave.waveId}
                    className={`flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                      selectedWaveId === wave.waveId ? 'border-blue-500 bg-blue-50' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="wave"
                      value={wave.waveId}
                      checked={selectedWaveId === wave.waveId}
                      onChange={() => setSelectedWaveId(wave.waveId)}
                      className="mr-3"
                      disabled={loading}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{wave.waveName}</div>
                      <div className="text-xs text-gray-500">Wave ID: {wave.waveId}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
            <strong>Note:</strong> All {motsIds.length} applications will be assigned to the selected wave.
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-6 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAssign}
            disabled={loading || !selectedWaveId || waves.length === 0}
            className="flex-1"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Assigning...
              </>
            ) : (
              `Assign to Wave`
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
