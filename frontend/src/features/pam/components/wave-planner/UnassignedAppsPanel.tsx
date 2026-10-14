import { useState, useEffect } from 'react'
import { dualApiClient } from '../../api/dualApiClient'

interface UnassignedApp {
  motsId: number
  appName: string
  primaryClli: string
  totalScore: number
  complexityBucket: string
}

interface UnassignedAppsResponse {
  content: UnassignedApp[]
  totalElements: number
  totalPages: number
  number: number
}

interface Wave {
  waveId: number
  waveName: string
  status: string
}

interface PodInfo {
  podId: number
  podName: string
  applicationCount: number
}

interface Props {
  onRefresh: () => void
  onAppClick?: (motsId: number) => void
}

function scoreColor(score: number) {
  if (score >= 80) return { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' }
  if (score >= 60) return { bg: '#fff7ed', text: '#9a3412', border: '#fdba74' }
  if (score >= 40) return { bg: '#fefce8', text: '#854d0e', border: '#fde047' }
  return { bg: '#f0fdf4', text: '#166534', border: '#86efac' }
}

export default function UnassignedAppsPanel({ onRefresh, onAppClick }: Props) {
  const [apps, setApps] = useState<UnassignedApp[]>([])
  const [waves, setWaves] = useState<Wave[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [expandedApp, setExpandedApp] = useState<number | null>(null)
  const [selectedWave, setSelectedWave] = useState<number | null>(null)
  const [selectedPod, setSelectedPod] = useState<number | null>(null)
  const [pods, setPods] = useState<PodInfo[]>([])
  const [processing, setProcessing] = useState(false)

  useEffect(() => { loadData() }, [page])

  const loadData = async () => {
    try {
      setLoading(true)
      const [appsData, wavesData] = await Promise.all([
        dualApiClient<UnassignedAppsResponse>('/api/applications/unassigned', {
          backend: 'migration-refinery', params: { page, size: 50, sort: 'total_score,desc' }
        }),
        dualApiClient<Wave[]>('/api/waves', { backend: 'migration-refinery' })
      ])
      setApps(appsData.content)
      setTotalPages(appsData.totalPages)
      setWaves(wavesData)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally { setLoading(false) }
  }

  const handleWaveSelect = async (waveId: number) => {
    setSelectedWave(waveId)
    setSelectedPod(null)
    setPods([])
    try {
      const data = await dualApiClient<PodInfo[]>(`/api/waves/${waveId}/pods`, { backend: 'migration-refinery' })
      setPods(data)
    } catch { setPods([]) }
  }

  const handleAddToWave = async (motsId: number) => {
    if (!selectedWave) return
    try {
      setProcessing(true)
      await dualApiClient(`/api/waves/${selectedWave}/applications`, {
        backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] }
      })
      if (selectedPod) {
        await dualApiClient(`/api/pods/${selectedPod}/applications`, {
          backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] }
        })
      }
      setExpandedApp(null)
      setSelectedWave(null)
      setSelectedPod(null)
      setPods([])
      onRefresh()
      loadData()
    } catch (error) {
      console.error('Failed to add app:', error)
      alert('Failed to add application')
    } finally { setProcessing(false) }
  }

  const filtered = apps.filter(a =>
    a.appName.toLowerCase().includes(search.toLowerCase()) || a.motsId.toString().includes(search)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', marginBottom: '8px' }}>Unassigned Applications</div>
        <input
          type="text" placeholder="Search apps..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
        />
      </div>

      {/* App List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748b', fontSize: '13px' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: '13px' }}>
            {search ? 'No matching applications' : 'All applications assigned'}
          </div>
        ) : filtered.map(app => {
          const sc = scoreColor(app.totalScore)
          const isExpanded = expandedApp === app.motsId
          return (
            <div key={app.motsId} style={{ padding: '10px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '6px', backgroundColor: 'white' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
                onClick={() => onAppClick?.(app.motsId)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.appName}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>MOTS: {app.motsId}</div>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, backgroundColor: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                  {app.totalScore}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '4px', marginTop: '6px', marginBottom: '6px' }}>
                <span style={{ fontSize: '10px', padding: '1px 6px', backgroundColor: '#f1f5f9', borderRadius: '4px', color: '#475569' }}>{app.primaryClli}</span>
                <span style={{ fontSize: '10px', padding: '1px 6px', backgroundColor: '#eff6ff', borderRadius: '4px', color: '#1d4ed8' }}>{app.complexityBucket}</span>
              </div>

              {isExpanded ? (
                <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <select value={selectedWave || ''} onChange={e => handleWaveSelect(Number(e.target.value))}
                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '6px' }}>
                    <option value="">Select Wave</option>
                    {waves.map(w => <option key={w.waveId} value={w.waveId}>{w.waveName}</option>)}
                  </select>
                  {selectedWave && (
                    <select value={selectedPod || ''} onChange={e => {
                      if (e.target.value === '__create__') {
                        const name = prompt(`New move group name for ${waves.find(w => w.waveId === selectedWave)?.waveName}:`)
                        if (name?.trim()) {
                          dualApiClient<PodInfo>(`/api/waves/${selectedWave}/pods`, {
                            backend: 'migration-refinery', method: 'POST', body: { podName: name.trim() }
                          }).then(pod => { setPods(prev => [...prev, pod]); setSelectedPod(pod.podId) }).catch(() => alert('Failed to create'))
                        }
                        return
                      }
                      setSelectedPod(Number(e.target.value) || null)
                    }}
                      style={{ width: '100%', padding: '5px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '6px' }}>
                      <option value="">Select Move Group (optional)</option>
                      <option value="__create__">+ Create New</option>
                      {pods.map(p => <option key={p.podId} value={p.podId}>{p.podName} ({p.applicationCount} apps)</option>)}
                    </select>
                  )}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => handleAddToWave(app.motsId)} disabled={!selectedWave || processing}
                      style={{ flex: 1, padding: '5px', fontSize: '12px', borderRadius: '6px', border: 'none', backgroundColor: selectedWave ? '#2563eb' : '#94a3b8', color: 'white', cursor: selectedWave ? 'pointer' : 'default' }}>
                      {processing ? 'Assigning...' : 'Assign'}
                    </button>
                    <button onClick={() => { setExpandedApp(null); setSelectedWave(null); setSelectedPod(null); setPods([]) }}
                      style={{ padding: '5px 10px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: 'white', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={e => { e.stopPropagation(); setExpandedApp(app.motsId); setSelectedWave(null) }}
                  style={{ width: '100%', padding: '5px', fontSize: '12px', borderRadius: '6px', border: '1px solid #d1d5db', backgroundColor: 'white', cursor: 'pointer', color: '#334155' }}>
                  + Add to Wave
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}>
            Prev
          </button>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ padding: '4px 10px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', backgroundColor: 'white', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}
