import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dualApiClient } from '../../api/dualApiClient'

interface ComprehensiveApp {
  motsId: number
  appName: string
  appAcronym: string | null
  businessCriticality: string | null
  primaryClli: string | null
  networkZone: string | null
  plannedDisposition: string | null
  hasPciData: boolean
  hasSoxRequirement: boolean
  hasSpiData: boolean
  hasCuiData: boolean
  hasPhiData: boolean
  languages: string[]
  frameworks: string[]
  runtimes: string[]
  totalServerCount: number
  vmServerCount: number
  servers: Array<{ serverId: string; hostname?: string | null; environmentClass: string; operatingSystem?: { osName?: string; osVersion?: string } | null }>
  databases: Array<{ instanceName: string; vendor: string | null; version: string | null; environmentClass: string }>
  contacts: Array<{ name: string; role: string | null; email: string | null }>
  applicationDependencies: Array<{ dependsOnMotsId: number; dependsOnAppName: string; dependencyType: string | null }>
}

interface ComplexityScore {
  effectiveTotalScore: number
  dataConfidence: number
  explanation?: { classification?: { finalBucket: string } }
}

interface WaveAssignment {
  waveId: number
  waveName: string
}

interface Props {
  motsId: number
  onClose: () => void
  waves?: Array<{ waveId: number; waveName: string; status: string }>
  onWaveAssigned?: () => void
}

function getBucket(score: number): string {
  if (score <= 22) return 'LOW'
  if (score <= 42) return 'MEDIUM'
  return 'HIGH'
}

function bucketColor(bucket: string) {
  if (bucket === 'HIGH') return { bg: '#fef2f2', text: '#dc2626', bar: '#dc2626' }
  if (bucket === 'MEDIUM') return { bg: '#fffbeb', text: '#d97706', bar: '#d97706' }
  return { bg: '#f0fdf4', text: '#16a34a', bar: '#16a34a' }
}

export default function ApplicationDetailPanel({ motsId, onClose, waves = [], onWaveAssigned }: Props) {
  const navigate = useNavigate()
  const [app, setApp] = useState<ComprehensiveApp | null>(null)
  const [complexity, setComplexity] = useState<ComplexityScore | null>(null)
  const [waveAssignment, setWaveAssignment] = useState<WaveAssignment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ overview: true, infrastructure: true, dependencies: true, actions: true })
  const [syncing, setSyncing] = useState(false)
  const [assigning, setAssigning] = useState(false)

  useEffect(() => {
    loadAppDetails()
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [motsId])

  const loadAppDetails = async () => {
    try {
      setLoading(true)
      setError(null)
      const [appData, complexityData] = await Promise.all([
        dualApiClient<ComprehensiveApp>(`/api/applications/${motsId}/comprehensive`, { backend: 'migration-refinery' }),
        dualApiClient<ComplexityScore>(`/api/applications/${motsId}/complexity`, { backend: 'migration-refinery', params: { explain: true } })
      ])
      setApp(appData)
      setComplexity(complexityData)
      try {
        const waveData = await dualApiClient<WaveAssignment>(`/api/applications/${motsId}/wave`, { backend: 'migration-refinery' })
        setWaveAssignment(waveData)
      } catch { setWaveAssignment(null) }
    } catch (err) {
      console.error('Failed to load app details:', err)
      setError('Failed to load application details')
    } finally { setLoading(false) }
  }

  const toggle = (s: string) => setExpanded(prev => ({ ...prev, [s]: !prev[s] }))

  const handleAssignToWave = async (waveId: number) => {
    try {
      setAssigning(true)
      await dualApiClient(`/api/waves/${waveId}/applications`, { backend: 'migration-refinery', method: 'POST', body: { motsIds: [motsId] } })
      await loadAppDetails()
      onWaveAssigned?.()
    } catch (err) {
      console.error('Failed to assign to wave:', err)
      alert('Failed to assign application to wave')
    } finally { setAssigning(false) }
  }

  const handleTriggerSync = async () => {
    if (!confirm(`Trigger data sync for ${app?.appName}?`)) return
    try {
      setSyncing(true)
      await dualApiClient(`/api/applications/${motsId}/sync`, { backend: 'migration-refinery', method: 'POST' })
      alert('Data sync triggered successfully')
      await loadAppDetails()
    } catch { alert('Failed to trigger data sync') }
    finally { setSyncing(false) }
  }

  const bucket = complexity?.explanation?.classification?.finalBucket ?? (complexity ? getBucket(complexity.effectiveTotalScore) : 'MEDIUM')
  const bc = bucketColor(bucket)
  const upstreamDeps = app?.applicationDependencies.filter(d => d.dependencyType !== 'downstream') || []
  const downstreamDeps = app?.applicationDependencies.filter(d => d.dependencyType === 'downstream') || []

  const sectionHeader = (label: string, key: string) => (
    <div onClick={() => toggle(key)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer', borderBottom: expanded[key] ? '1px solid #e2e8f0' : 'none' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>{label}</span>
      <span style={{ fontSize: '12px', color: '#94a3b8' }}>{expanded[key] ? '▲' : '▼'}</span>
    </div>
  )

  const row = (label: string, value: string | number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ fontWeight: 500, color: '#1e293b' }}>{value}</span>
    </div>
  )

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.2)', zIndex: 9998 }} />

      {/* Panel */}
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '480px', backgroundColor: 'white', borderLeft: '1px solid #e2e8f0', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', zIndex: 9999 }}>
        {/* Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '4px', fontSize: '18px', color: '#64748b', lineHeight: 1 }}>✕</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loading ? 'Loading...' : app?.appName || 'Application Details'}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>MOTS: {motsId}</div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b', fontSize: '14px' }}>Loading application details...</div>
          )}

          {error && (
            <div style={{ padding: '24px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ color: '#dc2626', fontWeight: 500, marginBottom: '8px' }}>Failed to load details</div>
              <button onClick={loadAppDetails} style={{ padding: '6px 16px', border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer', fontSize: '13px' }}>Retry</button>
            </div>
          )}

          {app && complexity && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Overview */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                {sectionHeader('Overview', 'overview')}
                {expanded.overview && (
                  <div style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>Complexity Score</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>{complexity.effectiveTotalScore}</span>
                        <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, backgroundColor: bc.bg, color: bc.text }}>{bucket}</span>
                      </div>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: '#e2e8f0', borderRadius: '3px', marginBottom: '12px' }}>
                      <div style={{ height: '6px', borderRadius: '3px', backgroundColor: bc.bar, width: `${Math.min(complexity.effectiveTotalScore, 100)}%` }} />
                    </div>
                    {app.businessCriticality && row('Business Criticality', app.businessCriticality)}
                    {row('Wave Assignment', waveAssignment ? waveAssignment.waveName : 'Unassigned')}
                    {row('Data Completeness', `${complexity.dataConfidence}%`)}
                    {app.primaryClli && row('Data Center', app.primaryClli)}
                  </div>
                )}
              </div>

              {/* Infrastructure */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                {sectionHeader('Infrastructure', 'infrastructure')}
                {expanded.infrastructure && (
                  <div style={{ padding: '12px 14px' }}>
                    {row('Total Servers', app.totalServerCount ?? 0)}
                    {row('VM Servers', `${app.vmServerCount ?? 0} (${app.totalServerCount ? Math.round((app.vmServerCount / app.totalServerCount) * 100) : 0}%)`)}
                    {row('Databases', app.databases?.length || 0)}
                    {app.networkZone && row('Network Zone', app.networkZone)}
                    {(app.languages.length > 0 || app.frameworks.length > 0) && (
                      <div style={{ marginTop: '8px' }}>
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Technology Stack</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {[...app.languages, ...app.frameworks].slice(0, 8).map(tech => (
                            <span key={tech} style={{ fontSize: '10px', backgroundColor: '#eef2ff', color: '#4338ca', padding: '2px 6px', borderRadius: '4px' }}>{tech}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dependencies */}
              {app.applicationDependencies.length > 0 && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  {sectionHeader('Dependencies', 'dependencies')}
                  {expanded.dependencies && (
                    <div style={{ padding: '12px 14px' }}>
                      {upstreamDeps.length > 0 && (
                        <div style={{ marginBottom: '8px' }}>
                          <div style={{ fontSize: '11px', fontWeight: 500, color: '#64748b', marginBottom: '4px' }}>Upstream ({upstreamDeps.length})</div>
                          {upstreamDeps.slice(0, 5).map(dep => (
                            <div key={dep.dependsOnMotsId}
                              style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', color: '#334155', marginBottom: '2px' }}>
                              • {dep.dependsOnAppName} <span style={{ color: '#94a3b8' }}>(MOTS: {dep.dependsOnMotsId})</span>
                            </div>
                          ))}
                          {upstreamDeps.length > 5 && <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>+{upstreamDeps.length - 5} more</div>}
                        </div>
                      )}
                      {downstreamDeps.length > 0 && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 500, color: '#64748b', marginBottom: '4px' }}>Downstream ({downstreamDeps.length})</div>
                          {downstreamDeps.slice(0, 5).map(dep => (
                            <div key={dep.dependsOnMotsId} onClick={() => navigate(`/wave-planner/applications/${dep.dependsOnMotsId}`)}
                              style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', color: '#334155', marginBottom: '2px' }}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#eef2ff')}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                              • {dep.dependsOnAppName} <span style={{ color: '#94a3b8' }}>(MOTS: {dep.dependsOnMotsId})</span>
                            </div>
                          ))}
                          {downstreamDeps.length > 5 && <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>+{downstreamDeps.length - 5} more</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                {sectionHeader('Actions', 'actions')}
                {expanded.actions && (
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {!waveAssignment && waves.length > 0 && (
                      <div>
                        <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Assign to Wave</label>
                        <select onChange={e => handleAssignToWave(Number(e.target.value))} disabled={assigning} defaultValue=""
                          style={{ width: '100%', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 10px' }}>
                          <option value="" disabled>Select a wave...</option>
                          {waves.map(w => <option key={w.waveId} value={w.waveId}>{w.waveName}</option>)}
                        </select>
                      </div>
                    )}
                    <button onClick={handleTriggerSync} disabled={syncing}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer', fontSize: '13px' }}>
                      {syncing ? 'Syncing...' : '↻ Trigger Data Sync'}
                    </button>
                    <button onClick={() => navigate(`/wave-planner/applications/${motsId}`)}
                      style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: 'white', cursor: 'pointer', fontSize: '13px' }}>
                      ↗ View Full Details
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
