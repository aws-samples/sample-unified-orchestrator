import { useState, useEffect } from 'react'
import { Lock, Trash2, Check, Loader2, X, Layers } from 'lucide-react'
import { dualApiClient } from '../../api/dualApiClient'

interface Wave {
  waveId: number
  waveName: string
  description: string | null
  status: 'proposed' | 'committed'
  applicationCount: number
  targetStartDate: string | null
  targetEndDate: string | null
}

interface WaveApp {
  motsId: number
  appName: string
  primaryClli: string
  totalScore: number
  complexityBucket: string
}

interface WaveAppsResponse { content: WaveApp[]; totalElements: number }
interface PodInfo { podId: number; podName: string; applicationCount: number }
interface PodApp { motsId: number; appName: string; totalScore: number }
interface PodAppsResponse { content: PodApp[] }

interface Props {
  wave: Wave
  onUpdate: () => void
  onAppClick?: (motsId: number) => void
}

const scoreColor = (score: number) =>
  score >= 80 ? { bg: '#fef2f2', text: '#991b1b', border: '#fca5a5' }
  : score >= 60 ? { bg: '#fff7ed', text: '#9a3412', border: '#fdba74' }
  : score >= 40 ? { bg: '#fefce8', text: '#854d0e', border: '#fde047' }
  : { bg: '#f0fdf4', text: '#166534', border: '#86efac' }

export default function WaveColumn({ wave, onUpdate, onAppClick }: Props) {
  const [apps, setApps] = useState<WaveApp[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [draggedMotsId, setDraggedMotsId] = useState<number | null>(null)
  const [pods, setPods] = useState<PodInfo[]>([])
  const [podApps, setPodApps] = useState<Record<number, PodApp[]>>({})

  useEffect(() => { loadWaveData() }, [wave.waveId, wave.applicationCount])

  useEffect(() => {
    const handleDragStart = (e: Event) => { setDraggedMotsId((e as CustomEvent).detail?.motsId || null) }
    const handleDragEnd = () => { setDraggedMotsId(null) }
    window.addEventListener('app-drag-start', handleDragStart)
    window.addEventListener('app-drag-end', handleDragEnd)
    return () => { window.removeEventListener('app-drag-start', handleDragStart); window.removeEventListener('app-drag-end', handleDragEnd) }
  }, [])

  const loadWaveData = async () => {
    try {
      setLoading(true)
      const [appsData, podsData] = await Promise.all([
        dualApiClient<WaveAppsResponse>(`/api/waves/${wave.waveId}/applications`, {
          backend: 'migration-refinery', params: { page: 0, size: 100, sort: 'mots_id,asc' }
        }),
        dualApiClient<PodInfo[]>(`/api/waves/${wave.waveId}/pods`, { backend: 'migration-refinery' })
      ])

      // Load pod apps before setting any state to avoid intermediate render
      let podAppsMap: Record<number, PodApp[]> = {}
      if (podsData.length > 0) {
        await Promise.all(podsData.map(async (pod) => {
          try {
            const res = await dualApiClient<PodAppsResponse>(`/api/pods/${pod.podId}/applications`, {
              backend: 'migration-refinery', params: { page: 0, size: 200, sort: 'mots_id,asc' }
            })
            podAppsMap[pod.podId] = res.content
          } catch { podAppsMap[pod.podId] = [] }
        }))
      }

      // Set all state at once
      setApps(appsData.content)
      setPods(podsData)
      setPodApps(podAppsMap)
    } catch (error) { console.error('Failed to load wave data:', error) }
    finally { setLoading(false) }
  }

  const handleDragOver = (e: React.DragEvent) => { if (wave.status === 'committed') return; e.preventDefault() }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    if (wave.status === 'committed' || !draggedMotsId) return
    await addAppToWave(draggedMotsId); setDraggedMotsId(null)
  }

  const addAppToWave = async (motsId: number) => {
    try {
      setProcessing(true)
      await dualApiClient(`/api/waves/${wave.waveId}/applications`, {
        backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] }
      })
      await loadWaveData(); onUpdate()
    } catch (error) { console.error('Failed to add app:', error); alert('Failed to add application to wave.') }
    finally { setProcessing(false) }
  }

  const removeAppFromWave = async (motsId: number) => {
    if (wave.status === 'committed') return
    try {
      setProcessing(true)
      await dualApiClient(`/api/waves/${wave.waveId}/applications/${motsId}`, { backend: 'migration-refinery', method: 'DELETE' })
      await loadWaveData(); onUpdate()
    } catch (error) { console.error('Failed to remove app:', error); alert('Failed to remove application') }
    finally { setProcessing(false) }
  }

  const commitWave = async () => {
    if (!confirm(`Commit ${wave.waveName}? This will lock the wave.`)) return
    try { setProcessing(true); await dualApiClient(`/api/waves/${wave.waveId}/commit`, { backend: 'migration-refinery', method: 'POST' }); onUpdate() }
    catch { alert('Failed to commit wave') } finally { setProcessing(false) }
  }

  const deleteWave = async () => {
    if (wave.status === 'committed') { alert('Cannot delete committed waves.'); return }
    if (!confirm(`Delete "${wave.waveName}"?`)) return
    try { setProcessing(true); await dualApiClient(`/api/waves/${wave.waveId}`, { backend: 'migration-refinery', method: 'DELETE' }); onUpdate() }
    catch { alert('Failed to delete wave.') } finally { setProcessing(false) }
  }

  const isCommitted = wave.status === 'committed'
  const podMotsIds = new Set(Object.values(podApps).flat().map(a => a.motsId))
  const ungroupedApps = apps.filter(a => !podMotsIds.has(a.motsId))

  const AppChip = ({ app }: { app: WaveApp }) => {
    const c = scoreColor(app.totalScore)
    return (
      <div onClick={() => onAppClick?.(app.motsId)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '4px 10px', borderRadius: '16px', cursor: 'pointer',
          border: `1px solid ${c.border}`, backgroundColor: c.bg,
          fontSize: '12px', whiteSpace: 'nowrap', transition: 'box-shadow 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)')}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
      >
        <span style={{ fontWeight: 600, color: '#111827', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.appName}</span>
        <span style={{ color: '#6b7280', fontSize: '10px' }}>{app.motsId}</span>
        <span style={{ fontWeight: 700, color: c.text, fontSize: '11px' }}>{app.totalScore}</span>
        {!isCommitted && (
          <span onClick={(e) => { e.stopPropagation(); removeAppFromWave(app.motsId) }}
            style={{ cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center', marginLeft: '2px' }}
            title="Remove">
            <X style={{ width: '12px', height: '12px' }} />
          </span>
        )}
      </div>
    )
  }

  const PodBox = ({ pod, podAppsList }: { pod: PodInfo; podAppsList: WaveApp[] }) => (
    <div style={{
      border: '1.5px solid #bae6fd', borderRadius: '10px', backgroundColor: '#f0f9ff',
      padding: '10px', marginBottom: '10px', minHeight: '52px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: podAppsList.length > 0 ? '8px' : '0' }}>
        <Layers style={{ width: '14px', height: '14px', color: '#0369a1' }} />
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>{pod.podName}</span>
        <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500 }}>({podAppsList.length})</span>
      </div>
      {podAppsList.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {podAppsList.map(app => <AppChip key={app.motsId} app={app} />)}
        </div>
      ) : (
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>No applications yet</div>
      )}
    </div>
  )

  return (
    <div style={{
      width: '480px', flexShrink: 0, backgroundColor: 'white', borderRadius: '10px',
      border: '2px solid #3b82f6', boxShadow: '0 2px 8px rgba(59,130,246,0.15)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', textAlign: 'center', backgroundColor: '#dbeafe', borderRadius: '8px 8px 0 0' }}>
        <h3 style={{ fontWeight: 600, fontSize: '16px', color: '#1e40af', margin: 0 }}>{wave.waveName}</h3>
        {wave.description && <p style={{ fontSize: '12px', color: '#3b82f6', marginTop: '4px' }}>{wave.description}</p>}
        {isCommitted && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '8px', padding: '2px 10px', fontSize: '12px', fontWeight: 500, backgroundColor: 'white', color: '#1e40af', borderRadius: '4px' }}>
            <Lock style={{ width: '12px', height: '12px' }} /> Committed
          </span>
        )}
        <div style={{ marginTop: '6px', fontSize: '13px', color: '#3b82f6' }}>
          {apps.length} app{apps.length !== 1 ? 's' : ''}{pods.length > 0 ? ` · ${pods.length} move group${pods.length !== 1 ? 's' : ''}` : ''}
        </div>
      </div>

      {/* Content */}
      <div onDragOver={handleDragOver} onDragLeave={() => {}} onDrop={handleDrop}
        style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <Loader2 style={{ width: '24px', height: '24px', animation: 'spin 1s linear infinite', color: '#2563eb' }} />
          </div>
        ) : apps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280', fontSize: '14px' }}>
            {isCommitted ? 'No applications' : 'Drag apps here'}
          </div>
        ) : (
          <>
            {pods.map(pod => {
              const pApps = podApps[pod.podId] || []
              const waveAppsInPod = apps.filter(a => pApps.some(pa => pa.motsId === a.motsId))
              return <PodBox key={pod.podId} pod={pod} podAppsList={waveAppsInPod} />
            })}

            {ungroupedApps.length > 0 && pods.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: pods.some(pod => (podApps[pod.podId] || []).length > 0) ? '6px' : '0' }}>
                {ungroupedApps.map(app => <AppChip key={app.motsId} app={app} />)}
              </div>
            )}

            {pods.length === 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {apps.map(app => <AppChip key={app.motsId} app={app} />)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px', borderTop: '1px solid #e5e7eb', backgroundColor: '#f9fafb', display: 'flex', gap: '8px', marginTop: 'auto' }}>
        {!isCommitted && (
          <button onClick={commitWave} disabled={processing || wave.applicationCount === 0}
            style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, border: 'none', color: 'white', backgroundColor: processing || wave.applicationCount === 0 ? '#9ca3af' : '#16a34a', cursor: processing || wave.applicationCount === 0 ? 'not-allowed' : 'pointer' }}>
            <Check style={{ width: '14px', height: '14px', marginRight: '6px' }} /> Commit
          </button>
        )}
        <button onClick={deleteWave} disabled={processing}
          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, border: 'none', color: 'white', backgroundColor: processing ? '#9ca3af' : '#dc2626', cursor: processing ? 'not-allowed' : 'pointer' }}>
          <Trash2 style={{ width: '14px', height: '14px', marginRight: '6px' }} /> Delete
        </button>
      </div>
    </div>
  )
}
