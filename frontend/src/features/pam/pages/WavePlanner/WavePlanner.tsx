import { useState, useEffect } from 'react'
import { Container, Header, SpaceBetween, Button, Spinner, Modal, FormField, Input, Select, Box } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'
import UnassignedAppsPanel from '../../components/wave-planner/UnassignedAppsPanel'
import WaveColumn from '../../components/wave-planner/WaveColumn'
import CreateWaveModal from '../../components/wave-planner/CreateWaveModal'
import BulkAssignModal from '../../components/wave-planner/BulkAssignModal'
import ApplicationDetailPanel from '../../components/wave-planner/ApplicationDetailPanel'

interface Wave {
  waveId: number
  waveName: string
  description: string | null
  status: 'proposed' | 'committed'
  applicationCount: number
  targetStartDate: string | null
  targetEndDate: string | null
}

export default function WavePlanner() {
  const [waves, setWaves] = useState<Wave[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false)
  const [bulkMotsIds, setBulkMotsIds] = useState<number[]>([])
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [selectedAppMotsId, setSelectedAppMotsId] = useState<number | null>(null)
  const [showCreatePodModal, setShowCreatePodModal] = useState(false)
  const [newPodWaveId, setNewPodWaveId] = useState<string | null>(null)
  const [newPodName, setNewPodName] = useState('')
  const [creatingPod, setCreatingPod] = useState(false)

  useEffect(() => {
    loadWaves()
  }, [refreshTrigger])

  const loadWaves = async () => {
    try {
      setLoading(true)
      const data = await dualApiClient<Wave[]>('/api/waves', {
        backend: 'migration-refinery'
      })
      setWaves(data)
    } catch (error) {
      console.error('Failed to load waves:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleWaveCreated = () => {
    setShowCreateModal(false)
    setRefreshTrigger(prev => prev + 1)
  }

  const handleWaveUpdated = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  const handleAppClick = (motsId: number) => {
    setSelectedAppMotsId(motsId)
  }

  const handleCloseDetailPanel = () => {
    setSelectedAppMotsId(null)
  }

  const handleWaveAssignedFromPanel = () => {
    setRefreshTrigger(prev => prev + 1)
  }

  const handleCreatePod = async () => {
    if (!newPodWaveId || !newPodName.trim()) return
    setCreatingPod(true)
    try {
      await dualApiClient(`/api/waves/${newPodWaveId}/pods`, {
        backend: 'migration-refinery', method: 'POST', body: { podName: newPodName.trim() }
      })
      setShowCreatePodModal(false)
      setNewPodName('')
      setNewPodWaveId(null)
      setRefreshTrigger(prev => prev + 1)
    } catch (err) { alert(`Failed to create move group: ${err}`) }
    finally { setCreatingPod(false) }
  }

  if (loading) {
    return <Spinner />
  }

  return (
    <Container
      header={
        <Header
          variant="h1"
          description="Organize applications into migration waves"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setShowCreatePodModal(true)}>New Move Group</Button>
              <Button variant="primary" onClick={() => setShowCreateModal(true)}>New Wave</Button>
            </SpaceBetween>
          }
        >
          Wave Planner
        </Header>
      }
    >
      <SpaceBetween size="l">
        <div style={{ display: 'flex', gap: '16px', height: '700px' }}>
          <div style={{ width: '320px', borderRight: '1px solid #e0e0e0', overflowY: 'auto' }}>
            <UnassignedAppsPanel onRefresh={handleWaveUpdated} onAppClick={handleAppClick} />
          </div>

          <div style={{ flex: 1, overflowX: 'auto', display: 'flex', gap: '16px' }}>
            {waves.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                <div style={{ textAlign: 'center' }}>
                  <p>No waves created yet</p>
                  <Button onClick={() => setShowCreateModal(true)}>Create First Wave</Button>
                </div>
              </div>
            ) : (
              waves.map(wave => (
                <WaveColumn
                  key={`${wave.waveId}-${refreshTrigger}`}
                  wave={wave}
                  onUpdate={handleWaveUpdated}
                  onAppClick={handleAppClick}
                />
              ))
            )}
          </div>
        </div>

        {showCreateModal && (
          <CreateWaveModal
            onClose={() => setShowCreateModal(false)}
            onSuccess={handleWaveCreated}
          />
        )}

        {showBulkAssignModal && (
          <BulkAssignModal
            motsIds={bulkMotsIds}
            waves={waves}
            onClose={() => setShowBulkAssignModal(false)}
            onSuccess={() => {
              setShowBulkAssignModal(false)
              setBulkMotsIds([])
              setRefreshTrigger(prev => prev + 1)
            }}
          />
        )}

        {selectedAppMotsId && (
          <ApplicationDetailPanel
            motsId={selectedAppMotsId}
            onClose={handleCloseDetailPanel}
            waves={waves}
            onWaveAssigned={handleWaveAssignedFromPanel}
          />
        )}

        {showCreatePodModal && (
          <Modal visible onDismiss={() => setShowCreatePodModal(false)} header="Create Move Group"
            footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setShowCreatePodModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleCreatePod} loading={creatingPod} disabled={!newPodWaveId || !newPodName.trim()}>Create</Button>
            </SpaceBetween></Box>}>
            <SpaceBetween size="m">
              <FormField label="Wave">
                <Select
                  selectedOption={newPodWaveId ? { label: waves.find(w => String(w.waveId) === newPodWaveId)?.waveName || '', value: newPodWaveId } : null}
                  onChange={({ detail }) => setNewPodWaveId(detail.selectedOption.value!)}
                  options={waves.map(w => ({ label: w.waveName, value: String(w.waveId) }))}
                  placeholder="Select wave"
                />
              </FormField>
              <FormField label="Move Group Name">
                <Input value={newPodName} onChange={({ detail }) => setNewPodName(detail.value)} placeholder="e.g. W1MG001" />
              </FormField>
            </SpaceBetween>
          </Modal>
        )}
      </SpaceBetween>
    </Container>
  )
}
