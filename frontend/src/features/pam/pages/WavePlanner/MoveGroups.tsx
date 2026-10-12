import { useState, useEffect } from 'react'
import { Container, Header, SpaceBetween, Button, Tabs, Table, Box, Alert, Input, Select, Modal, FormField } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'

interface Wave { waveId: number; waveName: string; status: string }
interface PodInfo { podId: number; waveId: number; podName: string; applicationCount: number }

interface ClusterMember { motsId: number; appName: string }
interface DistinguishingDimension { dimension: string; centroidValue: number; deviation: number }
interface ClusterSummary { clusterId: number; size: number; averageTotalScore: number; distinguishingDimensions?: DistinguishingDimension[]; members: ClusterMember[] }
interface ClusteringResponse { k: number; totalApplicationsClustered: number; excludedCount: number; clusters: ClusterSummary[] }

interface PartitionMember { motsId: number; appName: string; overallSimilarity: number }
interface PartitionGroup { referenceMotsId: number; referenceAppName: string; size: number; members: PartitionMember[] }
interface PartitionResponse { totalPartitioned: number; totalUnpartitioned: number; groups: PartitionGroup[]; unpartitioned: Array<{ motsId: number; appName: string; bestSimilarity: number }> }

// Per-group assignment state keyed by group id
interface GroupAssignState {
  waveId: string | null
  pods: PodInfo[]
  podId: string | null
  loading: boolean
  message: string | null
}

export default function MoveGroups() {
  const [activeTab, setActiveTab] = useState('cluster')
  const [k, setK] = useState('5')
  const [referenceMotsId, setReferenceMotsId] = useState('10000')
  const [clusterResult, setClusterResult] = useState<ClusteringResponse | null>(null)
  const [partitionResult, setPartitionResult] = useState<PartitionResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waves, setWaves] = useState<Wave[]>([])
  const [groupState, setGroupState] = useState<Record<number, GroupAssignState>>({})

  // Create pod modal
  const [createPodFor, setCreatePodFor] = useState<{ groupId: number; waveId: string } | null>(null)
  const [newPodName, setNewPodName] = useState('')
  const [creatingPod, setCreatingPod] = useState(false)

  useEffect(() => {
    dualApiClient<Wave[]>('/api/waves', { backend: 'migration-refinery' })
      .then(data => setWaves(data.filter(w => w.status === 'proposed')))
      .catch(() => {})
  }, [])

  const waveOptions = waves.map(w => ({ label: w.waveName, value: String(w.waveId) }))

  const getState = (groupId: number): GroupAssignState =>
    groupState[groupId] || { waveId: null, pods: [], podId: null, loading: false, message: null }

  const updateState = (groupId: number, patch: Partial<GroupAssignState>) =>
    setGroupState(prev => {
      const current = prev[groupId] || { waveId: null, pods: [], podId: null, loading: false, message: null }
      return { ...prev, [groupId]: { ...current, ...patch } }
    })

  const onWaveSelect = async (groupId: number, waveId: string) => {
    updateState(groupId, { waveId, podId: null, pods: [], message: null })
    try {
      const pods = await dualApiClient<PodInfo[]>(`/api/waves/${waveId}/pods`, { backend: 'migration-refinery' })
      updateState(groupId, { pods })
    } catch { updateState(groupId, { pods: [] }) }
  }

  const podOptions = (groupId: number) => {
    const s = getState(groupId)
    const opts = s.pods.map(p => ({ label: `${p.podName} (${p.applicationCount} apps)`, value: String(p.podId) }))
    return [{ label: '+ Create New Move Group', value: '__create__' }, ...opts]
  }

  const onPodSelect = (groupId: number, value: string) => {
    const s = getState(groupId)
    if (value === '__create__') {
      setCreatePodFor({ groupId, waveId: s.waveId! })
      setNewPodName('')
      return
    }
    updateState(groupId, { podId: value })
  }

  const handleCreatePod = async () => {
    if (!createPodFor || !newPodName.trim()) return
    setCreatingPod(true)
    try {
      const pod = await dualApiClient<PodInfo>(`/api/waves/${createPodFor.waveId}/pods`, {
        backend: 'migration-refinery', method: 'POST',
        body: { podName: newPodName.trim() }
      })
      const { groupId } = createPodFor
      const s = getState(groupId)
      updateState(groupId, { pods: [...s.pods, pod], podId: String(pod.podId) })
      setCreatePodFor(null)
    } catch (err) {
      alert(`Failed to create move group: ${err}`)
    } finally { setCreatingPod(false) }
  }

  const assignCluster = async (groupId: number, members: ClusterMember[]) => {
    const s = getState(groupId)
    if (!s.waveId) return
    updateState(groupId, { loading: true, message: null })
    try {
      // Filter to unassigned apps
      const unassigned = await dualApiClient<{ content: { motsId: number }[] }>('/api/applications/unassigned', {
        backend: 'migration-refinery', params: { page: 0, size: 5000 }
      })
      const unassignedIds = new Set(unassigned.content.map(a => a.motsId))
      const allIds = members.map(m => m.motsId)
      const eligibleIds = allIds.filter(id => unassignedIds.has(id))
      const skipped = allIds.length - eligibleIds.length

      if (eligibleIds.length === 0) {
        updateState(groupId, { loading: false, message: `All ${allIds.length} apps already assigned to a wave` })
        return
      }

      // 1. Add to wave
      await dualApiClient(`/api/waves/${s.waveId}/applications`, {
        backend: 'migration-refinery', method: 'POST', body: { motsIds: eligibleIds }
      })
      // 2. Add to pod if selected
      if (s.podId) {
        await dualApiClient(`/api/pods/${s.podId}/applications`, {
          backend: 'migration-refinery', method: 'POST', body: { motsIds: eligibleIds }
        })
      }

      const waveName = waves.find(w => String(w.waveId) === s.waveId)?.waveName
      const podName = s.podId ? s.pods.find(p => String(p.podId) === s.podId)?.podName : null
      const target = podName ? `${waveName} → ${podName}` : waveName
      const msg = skipped > 0
        ? `Assigned ${eligibleIds.length} apps to ${target} (${skipped} skipped)`
        : `Assigned ${eligibleIds.length} apps to ${target}`
      updateState(groupId, { loading: false, message: msg })
    } catch (err) {
      updateState(groupId, { loading: false, message: `Failed: ${err}` })
    }
  }

  const runClustering = async () => {
    setLoading(true); setError(null)
    try {
      const data = await dualApiClient<ClusteringResponse>('/api/move-groups/cluster', {
        backend: 'migration-refinery', method: 'POST', body: { k: Number(k), minScore: 0 }
      })
      setClusterResult(data)
    } catch (err) { setError(`Failed to cluster: ${err}`) }
    finally { setLoading(false) }
  }

  const runPartitioning = async () => {
    setLoading(true); setError(null)
    try {
      const data = await dualApiClient<PartitionResponse>('/api/move-groups/partition', {
        backend: 'migration-refinery', method: 'POST',
        body: { referenceMotsIds: [Number(referenceMotsId)], minSimilarity: 0.3 }
      })
      setPartitionResult(data)
    } catch (err) { setError(`Failed to partition: ${err}`) }
    finally { setLoading(false) }
  }

  // Shared assign UI for both cluster cards and partition groups
  const renderAssignControls = (groupId: number, members: ClusterMember[]) => {
    const s = getState(groupId)
    return (
      <SpaceBetween size="xs">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: '160px' }}>
            <Select
              selectedOption={s.waveId ? waveOptions.find(o => o.value === s.waveId) || null : null}
              onChange={({ detail }) => onWaveSelect(groupId, detail.selectedOption.value!)}
              options={waveOptions} placeholder="Select wave" expandToViewport
            />
          </div>
          {s.waveId && (
            <div style={{ minWidth: '200px' }}>
              <Select
                selectedOption={s.podId ? podOptions(groupId).find(o => o.value === s.podId) || null : null}
                onChange={({ detail }) => onPodSelect(groupId, detail.selectedOption.value!)}
                options={podOptions(groupId)} placeholder="Select move group" expandToViewport
              />
            </div>
          )}
          <Button variant="primary" onClick={() => assignCluster(groupId, members)}
            loading={s.loading} disabled={!s.waveId}>
            Assign
          </Button>
        </div>
        {s.message && (
          <div style={{ fontSize: '12px', color: s.message.startsWith('Failed') ? '#dc2626' : '#16a34a' }}>
            {s.message}
          </div>
        )}
      </SpaceBetween>
    )
  }

  return (
    <Container header={<Header variant="h1" description="Organize the entire portfolio into manageable groups">Move Groups</Header>}>
      <Tabs activeTabId={activeTab} onChange={({ detail }) => setActiveTab(detail.activeTabId)} tabs={[
        {
          id: 'cluster', label: 'Discover Groups',
          content: (
            <SpaceBetween size="m">
              <SpaceBetween direction="horizontal" size="xs">
                <Input type="number" value={k} onChange={({ detail }) => setK(detail.value)} placeholder="Number of groups (K)" />
                <Button variant="primary" onClick={runClustering} loading={loading}>Run Clustering</Button>
              </SpaceBetween>
              {error && <Alert type="error">{error}</Alert>}
              {clusterResult && (
                <>
                  <Box variant="p">{clusterResult.totalApplicationsClustered} apps clustered · {clusterResult.excludedCount} excluded</Box>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                    {clusterResult.clusters.map((cluster) => {
                      const avg = cluster.averageTotalScore
                      const color = avg >= 60 ? { bg: '#fef2f2', border: '#fca5a5', badge: '#dc2626' }
                        : avg >= 40 ? { bg: '#fff7ed', border: '#fdba74', badge: '#ea580c' }
                        : { bg: '#f0fdf4', border: '#86efac', badge: '#16a34a' }
                      return (
                        <div key={cluster.clusterId} style={{ backgroundColor: 'white', borderRadius: '12px', border: `1px solid ${color.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${color.border}`, backgroundColor: color.bg }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 600, fontSize: '15px', color: '#1e293b' }}>Group {cluster.clusterId + 1}</span>
                              <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, color: 'white', backgroundColor: color.badge }}>
                                {avg >= 60 ? 'HIGH' : avg >= 40 ? 'MEDIUM' : 'LOW'}
                              </span>
                            </div>
                            <div style={{ fontSize: '13px', color: '#64748b' }}>{cluster.size} apps · Avg score {cluster.averageTotalScore.toFixed(1)}</div>
                            {cluster.distinguishingDimensions && cluster.distinguishingDimensions.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                {cluster.distinguishingDimensions.map((d) => (
                                  <span key={d.dimension} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 500, backgroundColor: d.deviation < 0 ? '#dbeafe' : '#fef3c7', color: d.deviation < 0 ? '#1e40af' : '#92400e' }}>
                                    {d.dimension}: <strong>{d.deviation > 0 ? '+' : ''}{d.deviation.toFixed(2)}</strong>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {cluster.members.slice(0, 20).map((m) => (
                              <div key={m.motsId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 16px', fontSize: '12px', borderBottom: '1px solid #f1f5f9' }}>
                                <span style={{ color: '#334155', fontWeight: 500 }}>{m.appName}</span>
                                <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '11px' }}>{m.motsId}</span>
                              </div>
                            ))}
                            {cluster.members.length > 20 && (
                              <div style={{ padding: '6px 16px', fontSize: '11px', color: '#94a3b8' }}>+{cluster.members.length - 20} more</div>
                            )}
                          </div>
                          <div style={{ padding: '10px 16px', borderTop: `1px solid ${color.border}` }}>
                            {renderAssignControls(cluster.clusterId, cluster.members)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </SpaceBetween>
          ),
        },
        {
          id: 'partition', label: 'Assign to Patterns',
          content: (
            <SpaceBetween size="m">
              <SpaceBetween direction="horizontal" size="xs">
                <Input type="number" value={referenceMotsId} onChange={({ detail }) => setReferenceMotsId(detail.value)} placeholder="Reference MOTS ID" />
                <Button variant="primary" onClick={runPartitioning} loading={loading}>Run Partitioning</Button>
              </SpaceBetween>
              {error && <Alert type="error">{error}</Alert>}
              {partitionResult && (
                <>
                  <Box variant="p">{partitionResult.totalPartitioned} apps assigned · {partitionResult.totalUnpartitioned} unmatched</Box>
                  <SpaceBetween size="m">
                    {partitionResult.groups.map((group) => (
                      <Box key={group.referenceMotsId} variant="div">
                        <Header variant="h3">{group.referenceAppName} (MOTS {group.referenceMotsId}) - {group.size} matches</Header>
                        <div style={{ marginBottom: '8px' }}>
                          {renderAssignControls(group.referenceMotsId + 100000, group.members.map(m => ({ motsId: m.motsId, appName: m.appName })))}
                        </div>
                        <Table
                          columnDefinitions={[
                            { header: 'Application', cell: (item: PartitionMember) => item.appName },
                            { header: 'MOTS ID', cell: (item: PartitionMember) => item.motsId },
                            { header: 'Similarity', cell: (item: PartitionMember) => `${Math.round(item.overallSimilarity * 100)}%` },
                          ]}
                          items={group.members.slice(0, 50)} variant="embedded"
                        />
                      </Box>
                    ))}
                  </SpaceBetween>
                  {partitionResult.unpartitioned.length > 0 && (
                    <Box variant="div">
                      <Header variant="h3">Unmatched Applications ({partitionResult.unpartitioned.length})</Header>
                      <Table
                        columnDefinitions={[
                          { header: 'Application', cell: (item: { motsId: number; appName: string; bestSimilarity: number }) => item.appName },
                          { header: 'MOTS ID', cell: (item: { motsId: number; appName: string; bestSimilarity: number }) => item.motsId },
                          { header: 'Best Similarity', cell: (item: { motsId: number; appName: string; bestSimilarity: number }) => `${Math.round(item.bestSimilarity * 100)}%` },
                        ]}
                        items={partitionResult.unpartitioned} variant="embedded"
                      />
                    </Box>
                  )}
                </>
              )}
            </SpaceBetween>
          ),
        },
      ]} />

      {/* Create Move Group Modal */}
      {createPodFor && (
        <Modal visible onDismiss={() => setCreatePodFor(null)} header="Create Move Group"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setCreatePodFor(null)}>Cancel</Button>
                <Button variant="primary" onClick={handleCreatePod} loading={creatingPod} disabled={!newPodName.trim()}>Create</Button>
              </SpaceBetween>
            </Box>
          }>
          <FormField label="Move Group Name" description={`Will be created in ${waves.find(w => String(w.waveId) === createPodFor.waveId)?.waveName}`}>
            <Input value={newPodName} onChange={({ detail }) => setNewPodName(detail.value)} placeholder="e.g. W1MG001" />
          </FormField>
        </Modal>
      )}
    </Container>
  )
}
