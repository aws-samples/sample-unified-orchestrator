import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { dualApiClient } from '../../api/dualApiClient'

interface ComprehensiveApp {
  motsId: number
  appName: string
  appAcronym: string | null
  appStatus: string | null
  appType: string | null
  plannedDisposition: string | null
  primaryClli: string | null
  missionCriticalIndicator: string | null
  businessCriticality: string | null
  emergencyTier: string | null
  networkZone: string | null
  hasPciData: boolean
  hasSoxRequirement: boolean
  hasSpiData: boolean
  hasCuiData: boolean
  hasPhiData: boolean
  hasHighAvailability: boolean
  languages: string[]
  frameworks: string[]
  runtimes: string[]
  totalServerCount: number
  vmServerCount: number
  servers: Array<{
    serverId: string
    hostname?: string | null
    environmentClass: string
    operatingSystem?: { osName?: string; osVersion?: string; endOfLifeDate?: string } | null
  }>
  databases: Array<{ instanceName: string; vendor: string | null; version: string | null; environmentClass: string }>
  contacts: Array<{ name: string; role: string | null; email: string | null }>
  applicationDependencies: Array<{ dependsOnMotsId: number; dependsOnAppName: string; dependencyType: string | null }>
}

interface ComplexityScore {
  effectiveTotalScore: number
  dataConfidence: number
  totalScore: number
  baselineSizing: { score: number }
  infrastructureScale: { subtotal: number }
  modernizationDebt: { subtotal: number }
  dataComplexity: { subtotal: number }
  businessRisk: { subtotal: number }
  integrationComplexity: { subtotal: number }
  technologyProfile: { languageCountScore: number }
  technologyHops: { subtotal: number }
  explanation?: { classification?: { finalBucket: string } }
}

function getBucket(score: number) {
  if (score <= 22) return 'LOW'
  if (score <= 42) return 'MEDIUM'
  return 'HIGH'
}

function bucketStyle(bucket: string) {
  if (bucket === 'HIGH') return { bg: '#fef2f2', color: '#dc2626', bar: '#dc2626' }
  if (bucket === 'MEDIUM') return { bg: '#fffbeb', color: '#d97706', bar: '#d97706' }
  return { bg: '#f0fdf4', color: '#16a34a', bar: '#16a34a' }
}

const DIMS: [string, string][] = [
  ['baselineSizing', 'Baseline Sizing'],
  ['infrastructureScale', 'Infrastructure Scale'],
  ['modernizationDebt', 'Modernization Debt'],
  ['dataComplexity', 'Data Complexity'],
  ['businessRisk', 'Business Risk'],
  ['integrationComplexity', 'Integration Complexity'],
  ['technologyProfile', 'Technology Profile'],
  ['technologyHops', 'Technology Hops'],
]

function dimScore(c: ComplexityScore, key: string): number {
  const d = (c as unknown as Record<string, unknown>)[key] as Record<string, number> | undefined
  if (!d) return 0
  if (key === 'baselineSizing') return d.score ?? 0
  if (key === 'technologyProfile') return d.languageCountScore ?? 0
  return d.subtotal ?? 0
}

const card: React.CSSProperties = { backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const label: React.CSSProperties = { fontSize: '11px', color: '#64748b' }
const val: React.CSSProperties = { fontSize: '13px', fontWeight: 500, color: '#334155' }
const badge = (bg: string, color: string): React.CSSProperties => ({ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', backgroundColor: bg, color })

export default function ApplicationDetailPage() {
  const { motsId } = useParams<{ motsId: string }>()
  const navigate = useNavigate()
  const id = parseInt(motsId ?? '0', 10)
  const [app, setApp] = useState<ComprehensiveApp | null>(null)
  const [complexity, setComplexity] = useState<ComplexityScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        const [a, c] = await Promise.all([
          dualApiClient<ComprehensiveApp>(`/api/applications/${id}/comprehensive`, { backend: 'migration-refinery' }),
          dualApiClient<ComplexityScore>(`/api/applications/${id}/complexity`, { backend: 'migration-refinery', params: { explain: true } })
        ])
        setApp(a)
        setComplexity(c)
      } catch (e) { setError(String(e)) }
      finally { setLoading(false) }
    })()
  }, [id])

  if (loading) return <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748b' }}>Loading...</div>
  if (error) return <div style={{ textAlign: 'center', padding: '80px 0', color: '#dc2626' }}>Failed to load: {error}</div>
  if (!app || !complexity) return null

  const bucket = complexity.explanation?.classification?.finalBucket ?? getBucket(complexity.effectiveTotalScore)
  const bs = bucketStyle(bucket)
  const complianceFlags = [app.hasPciData && 'PCI', app.hasSoxRequirement && 'SOX', app.hasSpiData && 'SPI', app.hasCuiData && 'CUI', app.hasPhiData && 'PHI'].filter(Boolean) as string[]
  const maxDim = Math.max(...DIMS.map(([k]) => dimScore(complexity, k)), 1)

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Back */}
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#64748b', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '4px' }}>
        ← Back
      </button>

      {/* Header Card */}
      <div style={{ ...card, marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0f172a', margin: 0 }}>{app.appName}</h1>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px', fontSize: '13px', color: '#64748b' }}>
              <span style={{ fontFamily: 'monospace' }}>MOTS {app.motsId}</span>
              {app.appAcronym && <span>({app.appAcronym})</span>}
              {app.appStatus && <span style={badge('#f1f5f9', '#475569')}>{app.appStatus}</span>}
              {app.appType && <span style={badge('#f1f5f9', '#475569')}>{app.appType}</span>}
            </div>
          </div>
          <span style={{ ...badge(bs.bg, bs.color), fontSize: '13px', padding: '4px 12px' }}>{bucket}</span>
        </div>

        {/* Key attributes grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
          {app.businessCriticality && <div><div style={label}>Criticality</div><div style={val}>{app.businessCriticality}</div></div>}
          {app.primaryClli && <div><div style={label}>Data Center</div><div style={val}>{app.primaryClli}</div></div>}
          {app.networkZone && <div><div style={label}>Network Zone</div><div style={val}>{app.networkZone}</div></div>}
          {app.plannedDisposition && <div><div style={label}>Disposition</div><div style={val}>{app.plannedDisposition}</div></div>}
          <div><div style={label}>Complexity Score</div><div style={{ ...val, fontWeight: 700 }}>{complexity.effectiveTotalScore}</div></div>
          <div><div style={label}>Data Confidence</div><div style={val}>{complexity.dataConfidence}%</div></div>
          {complianceFlags.length > 0 && (
            <div>
              <div style={label}>Compliance</div>
              <div style={{ display: 'flex', gap: '4px', marginTop: '2px' }}>
                {complianceFlags.map(f => <span key={f} style={badge('#fffbeb', '#92400e')}>{f}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tech Stack */}
      {(app.languages.length > 0 || app.frameworks.length > 0 || app.runtimes.length > 0) && (
        <div style={{ ...card, marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 12px' }}>Technology Stack</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            {[['Languages', app.languages], ['Frameworks', app.frameworks], ['Runtimes', app.runtimes]].map(([lbl, items]) => (
              (items as string[]).length > 0 && (
                <div key={lbl as string}>
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>{lbl as string}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {(items as string[]).map(t => <span key={t} style={badge('#eef2ff', '#4338ca')}>{t}</span>)}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      )}

      {/* Complexity Breakdown */}
      <div style={{ ...card, marginBottom: '20px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px' }}>Complexity Breakdown</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {DIMS.map(([key, name]) => {
            const s = dimScore(complexity, key)
            const barColor = s <= 3 ? '#10b981' : s <= 6 ? '#f59e0b' : '#f43f5e'
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '160px', fontSize: '12px', color: '#475569', textAlign: 'right', flexShrink: 0 }}>{name}</div>
                <div style={{ flex: 1, height: '18px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(s / maxDim) * 100}%`, backgroundColor: barColor, borderRadius: '4px', transition: 'width 0.3s' }} />
                </div>
                <div style={{ width: '30px', fontSize: '12px', fontWeight: 600, color: '#334155', textAlign: 'right' }}>{s}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Infrastructure: Servers, Databases, Contacts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '20px' }}>
        {/* Servers */}
        {app.servers?.length > 0 && (
          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: '0 0 10px' }}>🖥 Servers ({app.totalServerCount ?? app.servers.length})</h3>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '10px', fontSize: '12px' }}>
              <div><span style={{ color: '#64748b' }}>Total: </span><span style={{ fontWeight: 600, color: '#334155' }}>{app.totalServerCount ?? app.servers.length}</span></div>
              <div><span style={{ color: '#64748b' }}>VM: </span><span style={{ fontWeight: 600, color: '#334155' }}>{app.vmServerCount ?? 0}</span></div>
              <div><span style={{ color: '#64748b' }}>VM %: </span><span style={{ fontWeight: 600, color: '#334155' }}>{app.totalServerCount ? Math.round((app.vmServerCount / app.totalServerCount) * 100) : 0}%</span></div>
            </div>
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {app.servers.map(s => (
                <div key={s.serverId} style={{ padding: '8px', border: '1px solid #f1f5f9', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 500, color: '#334155' }}>{s.hostname || s.serverId}</div>
                  <div style={{ color: '#94a3b8', marginTop: '2px' }}>
                    {s.environmentClass}
                    {s.operatingSystem && ` · ${[s.operatingSystem.osName, s.operatingSystem.osVersion].filter(Boolean).join(' ')}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Databases */}
        {app.databases?.length > 0 && (
          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: '0 0 10px' }}>🗄 Databases ({app.databases.length})</h3>
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {app.databases.map((db, i) => (
                <div key={i} style={{ padding: '8px', border: '1px solid #f1f5f9', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 500, color: '#334155' }}>{db.instanceName}</div>
                  <div style={{ color: '#94a3b8', marginTop: '2px' }}>{[db.vendor, db.version, db.environmentClass].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contacts */}
        {app.contacts?.length > 0 && (
          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: '0 0 10px' }}>👤 Contacts ({app.contacts.length})</h3>
            <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {app.contacts.map((c, i) => (
                <div key={i} style={{ padding: '8px', border: '1px solid #f1f5f9', borderRadius: '6px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 500, color: '#334155' }}>{c.name}</div>
                  <div style={{ color: '#94a3b8', marginTop: '2px' }}>{[c.role, c.email].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dependencies */}
      {app.applicationDependencies?.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: '0 0 10px' }}>🔗 Dependencies ({app.applicationDependencies.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
            {app.applicationDependencies.map(dep => (
              <div key={dep.dependsOnMotsId} onClick={() => navigate(`/applications/${dep.dependsOnMotsId}`)}
                style={{ padding: '8px', border: '1px solid #f1f5f9', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#eef2ff')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                <div style={{ fontWeight: 500, color: '#334155' }}>{dep.dependsOnAppName}</div>
                <div style={{ color: '#94a3b8', marginTop: '2px' }}>MOTS {dep.dependsOnMotsId}{dep.dependencyType && ` · ${dep.dependencyType}`}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
