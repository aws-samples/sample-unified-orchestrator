import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Container, Header, SpaceBetween, Button, Input, Tabs, Table, Box, Spinner, Alert, Select, Modal, FormField } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'

interface SharedTechnology {
  languages: string[]
  frameworks: string[]
  osFamilies: string[]
  dbVendors: string[]
}

interface SimilarityResult {
  motsId: number
  appName: string
  overallSimilarity: number
  technologySimilarity: number
  complexitySimilarity: number
  sharedTechnology: SharedTechnology
}

interface SimilarityResponse {
  referenceMotsId: number
  referenceAppName: string
  resultCount: number
  results: SimilarityResult[]
}

interface SimilarityLeaderboardEntry {
  motsId: number
  appName: string
  totalScore: number
  complexityBucket: string
  overallSimilarity: number
  sharedTechnology: SharedTechnology | null
  waveId: number | null
  waveName: string | null
}

interface SimilarityLeaderboardResponse {
  totalMatchingApps: number
  results: SimilarityLeaderboardEntry[]
}

const SIM_LENSES = [
  { id: 'big-rocks', label: 'Big Rocks' },
  { id: 'quick-wins', label: 'Quick Wins' },
  { id: 'business-priority', label: 'Business Priority' },
  { id: 'dependency-ready', label: 'Dependency Ready' },
  { id: 'confidence', label: 'Data Confidence' },
  { id: 'dependency-order', label: 'Dependency Order' },
]

interface Wave { waveId: number; waveName: string; status: string }
interface PodInfo { podId: number; waveId: number; podName: string; applicationCount: number }

export default function PatternMatching() {
  const navigate = useNavigate()
  const [referenceMotsId, setReferenceMotsId] = useState('10000')
  const [activeTab, setActiveTab] = useState('similar')
  const [simLens, setSimLens] = useState('big-rocks')
  const [similarity, setSimilarity] = useState<SimilarityResponse | null>(null)
  const [simLeaderboard, setSimLeaderboard] = useState<SimilarityLeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waves, setWaves] = useState<Wave[]>([])
  const [wavePods, setWavePods] = useState<Record<number, PodInfo[]>>({})
  const [appPodSelections, setAppPodSelections] = useState<Record<number, string>>({})
  // Reverse map: motsId → podId (from actual pod membership)
  const [appPodMap, setAppPodMap] = useState<Record<number, string>>({})
  // Track wave assignments for Find Similar tab
  const [appWaveMap, setAppWaveMap] = useState<Record<number, number>>({})
  const loadedWavePods = useRef<Set<number>>(new Set())

  const [createPodFor, setCreatePodFor] = useState<{ motsId: number; waveId: number } | null>(null)
  const [newPodName, setNewPodName] = useState('')
  const [creatingPod, setCreatingPod] = useState(false)


  useEffect(() => {
    dualApiClient<Wave[]>('/api/waves', { backend: 'migration-refinery' })
      .then(setWaves).catch(() => {})
  }, [])

  const waveOptions = [
    { label: 'Unassigned', value: 'null' },
    ...waves.map(w => ({ label: w.waveName, value: String(w.waveId) }))
  ]

  const loadPodsForWave = async (waveId: number) => {
    if (loadedWavePods.current.has(waveId)) return
    loadedWavePods.current.add(waveId)
    try {
      const pods = await dualApiClient<PodInfo[]>(`/api/waves/${waveId}/pods`, { backend: 'migration-refinery' })
      setWavePods(prev => ({ ...prev, [waveId]: pods }))
      const newMap: Record<number, string> = {}
      for (const pod of pods) {
        try {
          const res = await dualApiClient<{ content: { motsId: number }[] }>(`/api/pods/${pod.podId}/applications`, {
            backend: 'migration-refinery', params: { page: 0, size: 500, sort: 'mots_id,asc' }
          })
          res.content.forEach(a => { newMap[a.motsId] = String(pod.podId) })
        } catch {}
      }
      setAppPodMap(prev => ({ ...prev, ...newMap }))
    } catch { setWavePods(prev => ({ ...prev, [waveId]: [] })) }
  }

  const handleWaveChange = async (motsId: number, waveId: number | null) => {
    try {
      // Remove from current wave first (also removes pod assignment)
      const entry = simLeaderboard?.results.find(e => e.motsId === motsId)
      const currentWave = entry?.waveId || appWaveMap[motsId]
      if (currentWave) {
        await dualApiClient(`/api/waves/${currentWave}/applications/${motsId}`, { backend: 'migration-refinery', method: 'DELETE' })
      }
      // Add to new wave
      if (waveId) {
        await dualApiClient(`/api/waves/${waveId}/applications`, { backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] } })
        loadPodsForWave(waveId)
        setAppWaveMap(prev => ({ ...prev, [motsId]: waveId }))
      } else {
        setAppWaveMap(prev => { const n = { ...prev }; delete n[motsId]; return n })
      }
      setAppPodSelections(prev => { const n = { ...prev }; delete n[motsId]; return n })
      setAppPodMap(prev => { const n = { ...prev }; delete n[motsId]; return n })
      if (simLeaderboard) loadLeaderboard()
    } catch (err) { console.error('Failed to assign wave:', err) }
  }

  const handlePodChange = async (motsId: number, waveId: number, podId: string | null) => {
    if (!podId) return
    if (podId === '__create__') {
      setCreatePodFor({ motsId, waveId })
      setNewPodName('')
      return
    }
    try {
      const currentPod = appPodSelections[motsId] || appPodMap[motsId]
      if (currentPod) {
        await dualApiClient(`/api/pods/${currentPod}/applications/${motsId}`, { backend: 'migration-refinery', method: 'DELETE' })
      }
      await dualApiClient(`/api/pods/${podId}/applications`, { backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] } })
      setAppPodSelections(prev => ({ ...prev, [motsId]: podId }))
      setAppPodMap(prev => ({ ...prev, [motsId]: podId }))
    } catch (err) { console.error('Failed to assign move group:', err) }
  }

  const handleCreatePod = async () => {
    if (!createPodFor || !newPodName.trim()) return
    setCreatingPod(true)
    try {
      const pod = await dualApiClient<PodInfo>(`/api/waves/${createPodFor.waveId}/pods`, {
        backend: 'migration-refinery', method: 'POST', body: { podName: newPodName.trim() }
      })
      setWavePods(prev => ({ ...prev, [createPodFor.waveId]: [...(prev[createPodFor.waveId] || []), pod] }))
      const { motsId } = createPodFor
      const currentPod = appPodSelections[motsId] || appPodMap[motsId]
      if (currentPod) {
        await dualApiClient(`/api/pods/${currentPod}/applications/${motsId}`, { backend: 'migration-refinery', method: 'DELETE' })
      }
      await dualApiClient(`/api/pods/${pod.podId}/applications`, { backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] } })
      setAppPodSelections(prev => ({ ...prev, [motsId]: String(pod.podId) }))
      setAppPodMap(prev => ({ ...prev, [motsId]: String(pod.podId) }))
      setCreatePodFor(null)
    } catch (err) { alert(`Failed: ${err}`) }
    finally { setCreatingPod(false) }
  }

  const loadSimilarity = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await dualApiClient<SimilarityResponse>(`/api/applications/${referenceMotsId}/similarity`, {
        backend: 'migration-refinery',
        params: { limit: 100, minSimilarity: 0.3 }
      })
      setSimilarity(data)
      // Build wave map for results
      const motsIds = new Set(data.results.map(r => r.motsId))
      const wMap: Record<number, number> = {}
      for (const w of waves) {
        const res = await dualApiClient<{ content: { motsId: number }[] }>(`/api/waves/${w.waveId}/applications`, {
          backend: 'migration-refinery', params: { page: 0, size: 5000, sort: 'mots_id,asc' }
        })
        res.content.forEach(a => { if (motsIds.has(a.motsId)) wMap[a.motsId] = w.waveId })
      }
      setAppWaveMap(prev => ({ ...prev, ...wMap }))
      // Load pods for waves that have assignments
      const waveIds = [...new Set(Object.values(wMap))]
      for (const wId of waveIds) await loadPodsForWave(wId)
    } catch (err) {
      setError(`Failed to load similarity: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  const loadLeaderboard = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await dualApiClient<SimilarityLeaderboardResponse>('/api/applications/similarity/leaderboard', {
        backend: 'migration-refinery',
        method: 'POST',
        body: { referenceMotsIds: [Number(referenceMotsId)], minSimilarity: 0.3 },
        params: { sort: simLens, page: 0, size: 200 }
      })
      setSimLeaderboard(data)
    } catch (err) {
      setError(`Failed to load leaderboard: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Container
      header={
        <Header
          variant="h1"
          description="Find and reuse proven migration patterns"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Input
                type="number"
                value={referenceMotsId}
                onChange={({ detail }) => setReferenceMotsId(detail.value)}
                placeholder="Reference MOTS ID"
              />
              <Button variant="primary" onClick={activeTab === 'similar' ? loadSimilarity : loadLeaderboard}>
                Load Data
              </Button>
            </SpaceBetween>
          }
        >
          Pattern Matching
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Tabs
          activeTabId={activeTab}
          onChange={({ detail }) => setActiveTab(detail.activeTabId)}
          tabs={[
            {
              id: 'similar',
              label: 'Find Similar',
              content: (
                <SpaceBetween size="m">
                  {loading && <Spinner />}
                  {error && <Alert type="error">{error}</Alert>}
                  {similarity && (
                    <>
                      <Box variant="p">
                        Reference: <strong>{similarity.referenceAppName}</strong> · {similarity.resultCount} similar applications
                      </Box>
                      <Table
                        columnDefinitions={[
                          { header: '#', cell: (item: SimilarityResult) => similarity!.results.indexOf(item) + 1, width: 50 },
                          { header: 'Application', cell: (item: SimilarityResult) => (
                            <span onClick={() => navigate(`/wave-planner/applications/${item.motsId}`)} style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{item.appName}</span>
                          ) },
                          { header: 'MOTS ID', cell: (item: SimilarityResult) => item.motsId },
                          { header: 'Overall', cell: (item: SimilarityResult) => `${Math.round(item.overallSimilarity * 100)}%` },
                          { header: 'Technology', cell: (item: SimilarityResult) => `${Math.round(item.technologySimilarity * 100)}%` },
                          { header: 'Complexity', cell: (item: SimilarityResult) => `${Math.round(item.complexitySimilarity * 100)}%` },
                          { header: 'Wave', cell: (item: SimilarityResult) => {
                            const currentWave = appWaveMap[item.motsId] || null
                            const waveOpts = [{ label: 'Unassigned', value: 'null' }, ...waves.map(w => ({ label: w.waveName, value: String(w.waveId) }))]
                            return (
                              <Select
                                selectedOption={currentWave ? waveOpts.find(o => o.value === String(currentWave)) || null : null}
                                onChange={({ detail }) => handleWaveChange(item.motsId, detail.selectedOption.value === 'null' ? null : Number(detail.selectedOption.value))}
                                options={waveOpts} expandToViewport placeholder="Select wave"
                              />
                            )
                          }, width: 160 },
                          { header: 'Move Group', cell: (item: SimilarityResult) => {
                            const waveId = appWaveMap[item.motsId]
                            if (!waveId) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                            const pods = wavePods[waveId]
                            if (!pods) { loadPodsForWave(waveId); return <span style={{ color: '#94a3b8', fontSize: '12px' }}>Loading…</span> }
                            if (pods.length === 0) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>No groups</span>
                            const podOpts = [{ label: '+ Create New', value: '__create__' }, ...pods.map(p => ({ label: p.podName, value: String(p.podId) }))]
                            const selected = appPodSelections[item.motsId] || appPodMap[item.motsId] || null
                            return (
                              <Select
                                selectedOption={selected ? podOpts.find(o => o.value === selected) || null : null}
                                onChange={({ detail }) => handlePodChange(item.motsId, waveId, detail.selectedOption.value ?? null)}
                                options={podOpts} expandToViewport placeholder="Select group"
                              />
                            )
                          }, width: 180 },
                        ]}
                        items={similarity.results}
                        variant="embedded"
                      />
                    </>
                  )}
                </SpaceBetween>
              ),
            },
            {
              id: 'leaderboard',
              label: 'Similarity Leaderboard',
              content: (
                <SpaceBetween size="m">
                  <SpaceBetween direction="horizontal" size="xs">
                    {SIM_LENSES.map(lens => (
                      <Button
                        key={lens.id}
                        variant={simLens === lens.id ? 'primary' : 'normal'}
                        onClick={() => setSimLens(lens.id)}
                      >
                        {lens.label}
                      </Button>
                    ))}
                  </SpaceBetween>
                  {loading && <Spinner />}
                  {error && <Alert type="error">{error}</Alert>}
                  {simLeaderboard && (
                    <>
                      <Box variant="p">{simLeaderboard.totalMatchingApps} matching applications</Box>
                      <Table
                        columnDefinitions={[
                          { header: '#', cell: (item: SimilarityLeaderboardEntry) => simLeaderboard!.results.indexOf(item) + 1, width: 50 },
                          { header: 'Application', cell: (item: SimilarityLeaderboardEntry) => (
                            <span onClick={() => navigate(`/wave-planner/applications/${item.motsId}`)} style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{item.appName}</span>
                          ) },
                          { header: 'MOTS ID', cell: (item: SimilarityLeaderboardEntry) => item.motsId },
                          { header: 'Complexity', cell: (item: SimilarityLeaderboardEntry) => item.complexityBucket },
                          { header: 'Similarity', cell: (item: SimilarityLeaderboardEntry) => `${Math.round(item.overallSimilarity * 100)}%` },
                          {
                            header: 'Wave',
                            cell: (item: SimilarityLeaderboardEntry) => {
                              const selected = item.waveId
                                ? { label: item.waveName || '', value: String(item.waveId) }
                                : { label: 'Unassigned', value: 'null' }
                              return (
                                <Select
                                  selectedOption={selected}
                                  onChange={({ detail }) => handleWaveChange(item.motsId, detail.selectedOption.value === 'null' ? null : Number(detail.selectedOption.value))}
                                  options={waveOptions} expandToViewport placeholder="Select wave"
                                />
                              )
                            }, width: 180
                          },
                          {
                            header: 'Move Group',
                            cell: (item: SimilarityLeaderboardEntry) => {
                              if (!item.waveId) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                              const pods = wavePods[item.waveId]
                              if (!pods) { loadPodsForWave(item.waveId); return <span style={{ color: '#94a3b8', fontSize: '12px' }}>Loading…</span> }
                              if (pods.length === 0) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>No groups</span>
                              const selectedPod = appPodSelections[item.motsId] || appPodMap[item.motsId] || null
                              const podOpts = [{ label: '+ Create New', value: '__create__' }, ...pods.map(p => ({ label: p.podName, value: String(p.podId) }))]
                              return (
                                <Select
                                  selectedOption={selectedPod ? podOpts.find(o => o.value === selectedPod) || null : null}
                                  onChange={({ detail }) => handlePodChange(item.motsId, item.waveId!, detail.selectedOption.value ?? null)}
                                  options={podOpts} expandToViewport placeholder="Select group"
                                />
                              )
                            }, width: 180
                          },
                        ]}
                        items={simLeaderboard.results}
                        variant="embedded"
                      />
                    </>
                  )}
                </SpaceBetween>
              ),
            },
          ]}
        />
      </SpaceBetween>

      {createPodFor && (
        <Modal visible onDismiss={() => setCreatePodFor(null)} header="Create Move Group"
          footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">
            <Button onClick={() => setCreatePodFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleCreatePod} loading={creatingPod} disabled={!newPodName.trim()}>Create & Assign</Button>
          </SpaceBetween></Box>}>
          <FormField label="Move Group Name" description={`In ${waves.find(w => w.waveId === createPodFor.waveId)?.waveName}`}>
            <Input value={newPodName} onChange={({ detail }) => setNewPodName(detail.value)} placeholder="e.g. W1MG001" />
          </FormField>
        </Modal>
      )}
    </Container>
  )
}
