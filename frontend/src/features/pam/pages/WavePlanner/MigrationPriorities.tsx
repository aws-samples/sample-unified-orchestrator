import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Container, Header, SpaceBetween, Button, Table, Box, Alert, Select, Modal, FormField, Input } from '@cloudscape-design/components'
import { dualApiClient } from '../../api/dualApiClient'
import ExcelJS from 'exceljs'

const LENSES = [
  { id: 'big-rocks', label: 'Big Rocks' },
  { id: 'quick-wins', label: 'Quick Wins' },
  { id: 'business-priority', label: 'Business Priority' },
  { id: 'dependency-ready', label: 'Dependency Ready' },
  { id: 'confidence', label: 'Data Confidence' },
  { id: 'dependency-order', label: 'Dependency Order' },
]

interface DependencyInfo {
  motsId: number
  appName: string
  direction: string
  criticality: string
}

interface LeaderboardEntry {
  motsId: number
  appName: string
  effectiveTotalScore: number
  totalScore: number
  complexityBucket: string
  dataConfidence: number
  isOverridden: boolean
  waveId: number | null
  waveName: string | null
  upstreamDependencyCount: number | null
  downstreamDependencyCount: number | null
  dependencies: DependencyInfo[] | null
  baselineSizingTotal: number
  infrastructureScaleTotal: number
  modernizationDebtTotal: number
  dataComplexityTotal: number
  businessRiskTotal: number
  integrationComplexityTotal: number
  technologyHopsTotal: number
  languageCountScore: number
}

interface LeaderboardPage {
  content: LeaderboardEntry[]
  page: { totalElements: number }
}

interface Wave {
  waveId: number
  waveName: string
  status: string
}

const DIMS: [keyof LeaderboardEntry, string][] = [
  ['baselineSizingTotal', 'Baseline Sizing'],
  ['infrastructureScaleTotal', 'Infrastructure Scale'],
  ['modernizationDebtTotal', 'Modernization Debt'],
  ['dataComplexityTotal', 'Data Complexity'],
  ['businessRiskTotal', 'Business Risk'],
  ['integrationComplexityTotal', 'Integration Complexity'],
  ['languageCountScore', 'Technology Profile'],
  ['technologyHopsTotal', 'Technology Hops'],
]

function DepsCell({ item }: { item: LeaderboardEntry }) {
  const [show, setShow] = useState(false)
  const up = item.upstreamDependencyCount ?? 0
  const down = item.downstreamDependencyCount ?? 0
  if (up === 0 && down === 0) return <span style={{ color: '#94a3b8' }}>-</span>

  return (
    <>
      <span onClick={() => setShow(true)} style={{ color: '#2563eb', fontWeight: 500, cursor: 'pointer' }}>🔗 {up}↑ {down}↓</span>
      {show && (
        <>
          <div onClick={() => setShow(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999,
            backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)', minWidth: '280px', maxHeight: '60vh', overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{item.appName} — Dependencies</div>
              <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#94a3b8' }}>✕</button>
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>{up} upstream, {down} downstream</div>
            {(item.dependencies ?? []).map(dep => (
              <div key={dep.motsId} style={{ fontSize: '12px', padding: '4px 0', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                {dep.direction === 'UPSTREAM' ? '↑' : '↓'} {dep.appName} <span style={{ color: '#94a3b8' }}>({dep.motsId})</span>
              </div>
            ))}
            {(!item.dependencies || item.dependencies.length === 0) && (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>No dependency details available</div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function WhyScoreModal({ entry, onClose }: { entry: LeaderboardEntry; onClose: () => void }) {
  const maxDim = Math.max(...DIMS.map(([k]) => (entry[k] as number) || 0), 1)
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.25)', zIndex: 9998 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999, backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.15)', width: '560px', maxHeight: '80vh', overflow: 'auto', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>Why this score?</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>{entry.appName} · MOTS {entry.motsId}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#94a3b8' }}>✕</button>
        </div>

        {/* Dimension bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
          {DIMS.map(([key, label]) => {
            const s = (entry[key] as number) || 0
            const barColor = s <= 3 ? '#10b981' : s <= 6 ? '#f59e0b' : '#f43f5e'
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '140px', fontSize: '12px', color: '#475569', textAlign: 'right', flexShrink: 0 }}>{label}</div>
                <div style={{ flex: 1, height: '16px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(s / maxDim) * 100}%`, backgroundColor: barColor, borderRadius: '4px' }} />
                </div>
                <div style={{ width: '28px', fontSize: '12px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>{s}</div>
              </div>
            )
          })}
        </div>

        {/* Total */}
        <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
          <span>Total</span>
          <span>{entry.totalScore}</span>
        </div>

        {/* Classification */}
        <div style={{ marginTop: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '12px', display: 'flex', gap: '24px', fontSize: '12px' }}>
          <div>
            <div style={{ color: '#64748b' }}>Effective Score</div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{entry.effectiveTotalScore}</div>
          </div>
          <div>
            <div style={{ color: '#64748b' }}>Bucket</div>
            <div style={{ fontWeight: 600, color: entry.complexityBucket === 'HIGH' ? '#dc2626' : entry.complexityBucket === 'MEDIUM' ? '#d97706' : '#16a34a' }}>{entry.complexityBucket}</div>
          </div>
          <div>
            <div style={{ color: '#64748b' }}>Data Confidence</div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{entry.dataConfidence}%</div>
          </div>
          {entry.isOverridden && (
            <div style={{ alignSelf: 'center', fontSize: '10px', backgroundColor: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '10px', fontWeight: 500 }}>Override applied</div>
          )}
        </div>
      </div>
    </>
  )
}

interface PodInfo {
  podId: number
  waveId: number
  podName: string
  applicationCount: number
}

export default function MigrationPriorities() {
  const navigate = useNavigate()
  const [lens, setLens] = useState('big-rocks')
  const [leaderboard, setLeaderboard] = useState<LeaderboardPage | null>(null)
  const [waves, setWaves] = useState<Wave[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [explainEntry, setExplainEntry] = useState<LeaderboardEntry | null>(null)
  const [wavePods, setWavePods] = useState<Record<number, PodInfo[]>>({})
  const [appPodSelections, setAppPodSelections] = useState<Record<number, string>>({})
  const [appPodMap, setAppPodMap] = useState<Record<number, string>>({})
  const loadedWavePods = useRef<Set<number>>(new Set())

  // Create pod modal
  const [createPodFor, setCreatePodFor] = useState<{ motsId: number; waveId: number } | null>(null)
  const [newPodName, setNewPodName] = useState('')
  const [creatingPod, setCreatingPod] = useState(false)

  useEffect(() => { loadWaves() }, [])

  const loadWaves = async () => {
    try {
      const data = await dualApiClient<Wave[]>('/api/waves', { backend: 'migration-refinery' })
      setWaves(data)
    } catch (err) { console.error('Failed to load waves:', err) }
  }

  const loadPodsForWave = async (waveId: number, force = false) => {
    if (!force && loadedWavePods.current.has(waveId)) return
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

  const loadLeaderboard = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await dualApiClient<LeaderboardPage>('/api/applications/complexity/leaderboard', {
        backend: 'migration-refinery',
        params: { sort: lens, page: 0, size: 200, includeDependencies: true }
      })
      setLeaderboard(data)
      // Load pods sequentially to avoid rate limiting
      const waveIds = [...new Set(data.content.filter(e => e.waveId).map(e => e.waveId!))]
      for (const wId of waveIds) {
        await loadPodsForWave(wId)
      }
    } catch (err) { setError(`Failed to load leaderboard: ${err}`) }
    finally { setLoading(false) }
  }

  const handleWaveChange = async (motsId: number, waveId: number | null) => {
    try {
      // Remove from current wave first (also removes pod assignment)
      const entry = leaderboard?.content.find(e => e.motsId === motsId)
      if (entry?.waveId) {
        await dualApiClient(`/api/waves/${entry.waveId}/applications/${motsId}`, { backend: 'migration-refinery', method: 'DELETE' })
      }
      // Add to new wave
      if (waveId) {
        await dualApiClient(`/api/waves/${waveId}/applications`, { backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] } })
        loadPodsForWave(waveId, true)
      }
      setAppPodSelections(prev => { const n = { ...prev }; delete n[motsId]; return n })
      setAppPodMap(prev => { const n = { ...prev }; delete n[motsId]; return n })
      loadLeaderboard()
    } catch (err) { console.error('Failed to update wave assignment:', err) }
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
    } catch (err) { console.error('Failed to assign to move group:', err) }
  }

  const handleCreatePod = async () => {
    if (!createPodFor || !newPodName.trim()) return
    setCreatingPod(true)
    try {
      const pod = await dualApiClient<PodInfo>(`/api/waves/${createPodFor.waveId}/pods`, {
        backend: 'migration-refinery', method: 'POST', body: { podName: newPodName.trim() }
      })
      setWavePods(prev => ({ ...prev, [createPodFor.waveId]: [...(prev[createPodFor.waveId] || []), pod] }))
      // Auto-assign the app to the new pod
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

  const exportToExcel = async () => {
    if (!leaderboard) return
    const rows = leaderboard.content.map((item, i) => ({
      '#': i + 1,
      'Application': item.appName,
      'MOTS ID': item.motsId,
      'Score': item.effectiveTotalScore,
      'Complexity': item.complexityBucket,
      'Confidence (%)': item.dataConfidence,
      'Wave': item.waveName || 'Unassigned',
      'Move Group': item.waveId && wavePods[item.waveId] ? (wavePods[item.waveId].find(p => String(p.podId) === (appPodSelections[item.motsId] || appPodMap[item.motsId]))?.podName || '') : '',
      'Upstream Deps': item.upstreamDependencyCount ?? 0,
      'Downstream Deps': item.downstreamDependencyCount ?? 0,
      'Baseline Sizing': item.baselineSizingTotal,
      'Infrastructure Scale': item.infrastructureScaleTotal,
      'Modernization Debt': item.modernizationDebtTotal,
      'Data Complexity': item.dataComplexityTotal,
      'Business Risk': item.businessRiskTotal,
      'Integration Complexity': item.integrationComplexityTotal,
      'Technology Profile': item.languageCountScore,
      'Technology Hops': item.technologyHopsTotal,
    }))
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Migration Priorities')
    const headers = rows.length > 0 ? Object.keys(rows[0]) : []
    ws.columns = headers.map((h) => ({ header: h, key: h }))
    rows.forEach((row) => ws.addRow(row))

    const lensLabel = LENSES.find(l => l.id === lens)?.label ?? lens
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Migration_Priorities_${lensLabel.replace(/\s+/g, '_')}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const waveOptions = [
    { label: 'Unassigned', value: 'null' },
    ...waves.map(w => ({ label: w.waveName, value: String(w.waveId) }))
  ]

  return (
    <Container
      header={
        <Header variant="h1" description="Ranked migration plan with multiple strategic lenses"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {leaderboard && <Button iconName="download" onClick={exportToExcel}>Export to Excel</Button>}
              <Button variant="primary" onClick={loadLeaderboard} loading={loading}>Load Data</Button>
            </SpaceBetween>
          }>
          Migration Priorities
        </Header>
      }
    >
      <SpaceBetween size="l">
        <SpaceBetween direction="horizontal" size="xs">
          {LENSES.map(l => (
            <Button key={l.id} variant={lens === l.id ? 'primary' : 'normal'} onClick={() => setLens(l.id)}>{l.label}</Button>
          ))}
        </SpaceBetween>

        {error && <Alert type="error">{error}</Alert>}

        {leaderboard && (
          <>
            <Box variant="p">Showing {leaderboard.content.length} of {leaderboard.page.totalElements} applications</Box>
            <Table
              columnDefinitions={[
                { header: '#', cell: (item: LeaderboardEntry) => leaderboard!.content.indexOf(item) + 1, width: 50 },
                { header: 'Application', cell: (item: LeaderboardEntry) => (
                  <span onClick={() => navigate(`/wave-planner/applications/${item.motsId}`)} style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{item.appName}</span>
                ) },
                { header: 'MOTS ID', cell: (item: LeaderboardEntry) => item.motsId, width: 100 },
                { header: 'Score', cell: (item: LeaderboardEntry) => item.effectiveTotalScore, width: 80 },
                { header: 'Complexity', cell: (item: LeaderboardEntry) => (
                  <span style={{
                    padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                    backgroundColor: item.complexityBucket === 'HIGH' ? '#fef2f2' : item.complexityBucket === 'MEDIUM' ? '#fffbeb' : '#f0fdf4',
                    color: item.complexityBucket === 'HIGH' ? '#dc2626' : item.complexityBucket === 'MEDIUM' ? '#d97706' : '#16a34a'
                  }}>{item.complexityBucket}</span>
                ), width: 120 },
                { header: 'Confidence', cell: (item: LeaderboardEntry) => `${item.dataConfidence}%`, width: 100 },
                {
                  header: 'Wave',
                  cell: (item: LeaderboardEntry) => (
                    <Select
                      selectedOption={item.waveId ? { label: item.waveName || '', value: String(item.waveId) } : { label: 'Unassigned', value: 'null' }}
                      onChange={({ detail }) => handleWaveChange(item.motsId, detail.selectedOption.value === 'null' ? null : Number(detail.selectedOption.value))}
                      options={waveOptions} expandToViewport placeholder="Select wave"
                    />
                  ), width: 180
                },
                {
                  header: 'Move Group',
                  cell: (item: LeaderboardEntry) => {
                    if (!item.waveId) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>—</span>
                    const pods = wavePods[item.waveId]
                    if (!pods) { loadPodsForWave(item.waveId); return <span style={{ color: '#94a3b8', fontSize: '12px' }}>Loading…</span> }
                    if (pods.length === 0) return <span style={{ color: '#94a3b8', fontSize: '12px' }}>No groups</span>
                    const podOpts = [{ label: '+ Create New', value: '__create__' }, ...pods.map(p => ({ label: p.podName, value: String(p.podId) }))]
                    const selected = appPodSelections[item.motsId] || appPodMap[item.motsId] || null
                    return (
                      <Select
                        selectedOption={selected ? podOpts.find(o => o.value === selected) || null : null}
                        onChange={({ detail }) => handlePodChange(item.motsId, item.waveId!, detail.selectedOption.value ?? null)}
                        options={podOpts} expandToViewport placeholder="Select group"
                      />
                    )
                  }, width: 180
                },
                { header: 'Deps', cell: (item: LeaderboardEntry) => <DepsCell item={item} />, width: 100 },
                { header: '', cell: (item: LeaderboardEntry) => (
                  <span onClick={() => setExplainEntry(item)} style={{ cursor: 'pointer', color: '#64748b', fontSize: '16px' }} title="Why this score?">❓</span>
                ), width: 50 },
              ]}
              items={leaderboard.content}
              variant="embedded"
            />
          </>
        )}
      </SpaceBetween>

      {explainEntry && <WhyScoreModal entry={explainEntry} onClose={() => setExplainEntry(null)} />}

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
