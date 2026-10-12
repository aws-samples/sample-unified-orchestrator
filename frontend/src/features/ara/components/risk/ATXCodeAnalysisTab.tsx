import { useState, useEffect } from 'react'
import {
  Container, Header, SpaceBetween, Box, Badge, StatusIndicator,
  Tabs, Table, ColumnLayout, ExpandableSection, Spinner, Alert
} from '@cloudscape-design/components'
import apiClient from '../../../uno/services/api'

import MermaidDiagram from './MermaidDiagram'

interface CodeAnalysisTabProps {
  applicationId: string | null
  loading?: boolean
  analysisInfo?: any
  runId?: string
}

interface RepoAssessment {
  repo_name: string
  run_id: string
  assessed_at: string
  summary: string
  // Project & Architecture
  project_overview: any
  system_overview: any
  components: any[]
  design_patterns: any[]
  dependencies: any[]
  program_structure: any
  // Behavior
  business_logic: any[]
  workflows: any[]
  decision_logic: any[]
  error_handling: any
  // Diagrams
  system_context_diagram: any
  component_diagram: any
  sequence_diagram: any
  diagrams: string[]
  // Reference
  interfaces: any[]
  data_models: any[]
  api_reference: any[]
  // Analysis
  security_patterns: any
  code_metrics: any
  complexity_analysis: any
  dependency_analysis: any
  // Migration
  component_order: any[]
  test_specifications: any[]
  validation_criteria: any[]
  // Technical Debt
  technical_debt_summary: any
  technical_debt_report: any
  outdated_components: any[]
  maintenance_burden: any
  remediation_plan: any[]
  // Additional / backward-compatible
  current_state: any
  target_state: any
  security: any
  technical_debt: any
  complexity: any
  migration_plan: any[]
  breaking_changes: any[]
  component_inventory: any[]
  api_surface: any[]
  data_stores: any[]
  deployment_topology: any
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const str = (v: any) => (v == null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const arr = (v: any): any[] => (Array.isArray(v) ? v : [])
const obj = (v: any): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

function renderKV(data: any, label?: string) {
  if (!data || typeof data !== 'object') return null
  const entries = Array.isArray(data)
    ? data.map((e: any) => ({ k: e.name || e.technology || e.component || '-', v: e.version || e.value || '-' }))
    : Object.entries(data).map(([k, v]) => ({ k, v: typeof v === 'object' ? JSON.stringify(v) : String(v ?? '-') }))
  if (!entries.length) return <Box color="text-body-secondary">No data</Box>
  return (
    <Table
      columnDefinitions={[
        { id: 'k', header: label || 'Key', cell: (e: any) => str(e.k), width: 220 },
        { id: 'v', header: 'Value', cell: (e: any) => <Box variant="small" display="block">{str(e.v)}</Box>, width: 300 },
      ]}
      items={entries.slice(0, 40)}
      variant="embedded"
      wrapLines
    />
  )
}

function renderDiagramSection(diag: any, title: string) {
  if (!diag) return null
  const d = obj(diag)
  const mermaid = d.mermaid_code || ''
  return (
    <Container header={<Header variant="h3">{title}</Header>}>
      <SpaceBetween size="s">
        {d.description && <Box>{str(d.description)}</Box>}
        {mermaid && <MermaidDiagram chart={mermaid} />}
        {arr(d.actors).length > 0 && (
          <ExpandableSection headerText={`Actors (${d.actors.length})`}>
            <Table columnDefinitions={[
              { id: 'name', header: 'Name', cell: (a: any) => str(a.name), width: 150 },
              { id: 'type', header: 'Type', cell: (a: any) => str(a.type), width: 100 },
              { id: 'desc', header: 'Description', cell: (a: any) => str(a.description), width: 300 },
            ]} items={d.actors} variant="embedded" wrapLines />
          </ExpandableSection>
        )}
        {arr(d.external_systems).length > 0 && (
          <ExpandableSection headerText={`External Systems (${d.external_systems.length})`}>
            <Table columnDefinitions={[
              { id: 'name', header: 'Name', cell: (a: any) => str(a.name), width: 200 },
              { id: 'desc', header: 'Description', cell: (a: any) => str(a.description), width: 350 },
            ]} items={d.external_systems} variant="embedded" wrapLines />
          </ExpandableSection>
        )}
        {arr(d.layers).length > 0 && (
          <ExpandableSection headerText={`Layers (${d.layers.length})`}>
            {d.layers.map((l: any, i: number) => (
              <Box key={i} padding={{ vertical: 'xxs' }}><Badge>{str(l.name)}</Badge> {arr(l.components).join(', ')}</Box>
            ))}
          </ExpandableSection>
        )}
        {arr(d.flows).length > 0 && (
          <ExpandableSection headerText={`Flows (${d.flows.length})`}>
            <Table columnDefinitions={[
              { id: 'name', header: 'Flow', cell: (f: any) => str(f.name), width: 200 },
              { id: 'participants', header: 'Participants', cell: (f: any) => arr(f.participants).join(', '), width: 200 },
              { id: 'desc', header: 'Description', cell: (f: any) => str(f.description), width: 250 },
            ]} items={d.flows} variant="embedded" wrapLines />
          </ExpandableSection>
        )}
      </SpaceBetween>
    </Container>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CodeAnalysisTab({ applicationId, loading = false, analysisInfo, runId }: CodeAnalysisTabProps) {
  const [hasData, setHasData] = useState(false)
  const [repos, setRepos] = useState<RepoAssessment[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeRepoTab, setActiveRepoTab] = useState<string>('')
  const [activeMainTab, setActiveMainTab] = useState<string>('analysis')
  const [loadedRepos, setLoadedRepos] = useState<Set<string>>(new Set())
  const [scmUrls, setScmUrls] = useState<Record<string, string>>({})

  useEffect(() => { if (applicationId) loadAssessment() }, [applicationId, runId])
  useEffect(() => {
    if (activeRepoTab && !loadedRepos.has(activeRepoTab))
      setLoadedRepos(prev => new Set([...prev, activeRepoTab]))
  }, [activeRepoTab])

  const loadAssessment = async () => {
    if (!applicationId) return
    setLoadingData(true); setError(null)
    try {
      const params = new URLSearchParams({ include: 'assessments' })
      if (runId) params.set('run_id', runId)
      const resp = await apiClient.get(`/ara/atx/applications/${applicationId}?${params.toString()}`)
      const data = resp.data.data?.assessments
      let repoList = data?.repos || (Array.isArray(data) ? data : null)
      if (!repoList && data && data.repo_name) repoList = [data]
      if (repoList && repoList.length > 0) {
        setRepos(repoList); setHasData(true); setActiveRepoTab(repoList[0].repo_name)
        try {
          const appResp = await apiClient.get('/wave/applications?summary=false')
          const apps = appResp.data.data?.applications || []
          const app = apps.find((a: any) => a.application_id === applicationId)
          if (app?.scm_urls) {
            const urlMap: Record<string, string> = {}
            for (const url of app.scm_urls) { const n = url.split('/').pop()?.replace('.git', '') || ''; if (n) urlMap[n] = url }
            setScmUrls(urlMap)
          }
        } catch { /* ignore */ }
      } else { setHasData(false) }
    } catch (e: any) { e.response?.status === 404 ? setHasData(false) : setError(e.message) }
    setLoadingData(false)
  }

  if (loading || loadingData) return <Container><Spinner size="large" /> Loading code analysis...</Container>
  if (error) return <Alert type="error">{error}</Alert>
  if (!hasData) return (
    <Container header={<Header variant="h2">Code Analysis</Header>}>
      <Box textAlign="center" padding="l" color="text-body-secondary">No code analysis data available. Run ATX Code Analysis first.</Box>
    </Container>
  )

  // Aggregate summary
  const totalDebt = repos.reduce((sum, r) => {
    const debt = r.technical_debt_summary || r.technical_debt || {}
    const c = (k: string) => Array.isArray((debt as any)[k]) ? (debt as any)[k].length : (typeof (debt as any)[k] === 'number' ? (debt as any)[k] : 0)
    return sum + c('critical') + c('high') + c('medium') + c('low')
  }, 0)
  const totalDeps = repos.reduce((sum, r) => sum + arr(r.dependencies).length, 0)
  const totalVulns = repos.reduce((sum, r) => {
    const sec = r.security_patterns || r.security || {}
    return sum + (sec.total_vulnerabilities || sec.critical || 0)
  }, 0)

  // ── Render per-repo assessment ──────────────────────────────────────────────
  const renderRepoContent = (repo: RepoAssessment) => {
    if (!loadedRepos.has(repo.repo_name)) return <Box padding="l"><Spinner /> Loading...</Box>

    const po = obj(repo.project_overview)
    const so = obj(repo.system_overview)
    const cs = obj(repo.current_state)
    const ts = obj(repo.target_state)
    const ps = obj(repo.program_structure)
    const eh = obj(repo.error_handling)
    const sp = obj(repo.security_patterns || repo.security)
    const cm = obj(repo.code_metrics)
    const ca = obj(repo.complexity_analysis || repo.complexity)
    const da = obj(repo.dependency_analysis)
    const tds = obj(repo.technical_debt_summary || repo.technical_debt)
    const tdr = obj(repo.technical_debt_report)
    const mb = obj(repo.maintenance_burden)

    const deps = arr(repo.dependencies)
    const comps = arr(repo.components || repo.component_inventory)
    const patterns = arr(repo.design_patterns)
    const bl = arr(repo.business_logic)
    const wf = arr(repo.workflows)
    const dl = arr(repo.decision_logic)
    const ifaces = arr(repo.interfaces)
    const dm = arr(repo.data_models)
    const apiRef = arr(repo.api_reference)
    const co = arr(repo.component_order)
    const ts_ = arr(repo.test_specifications)
    const vc = arr(repo.validation_criteria)
    const oc = arr(repo.outdated_components)
    const rp = arr(repo.remediation_plan)
    const plan = arr(repo.migration_plan)
    const bc = arr(repo.breaking_changes)
    const apiSurf = arr(repo.api_surface)
    const ds = arr(repo.data_stores)
    const diagrams = arr(repo.diagrams)
    const deployTopo = repo.deployment_topology

    return (
      <SpaceBetween size="l">
        {/* Summary */}
        {repo.summary && <Alert type="info">{typeof repo.summary === 'object' ? JSON.stringify(repo.summary) : String(repo.summary)}</Alert>}
        {repo.run_id && <Box variant="small" color="text-body-secondary">Run ID: {repo.run_id}</Box>}
        {scmUrls[repo.repo_name] && <Box><a href={scmUrls[repo.repo_name]} target="_blank" rel="noopener noreferrer">{scmUrls[repo.repo_name]}</a></Box>}

        {/* 1. Project Overview */}
        {Object.keys(po).length > 0 && (
          <Container header={<Header variant="h3">Project Overview</Header>}>
            <ColumnLayout columns={4}>
              {po.app_name && <div><Box variant="awsui-key-label">Application</Box><Box>{str(po.app_name)}</Box></div>}
              {po.language && <div><Box variant="awsui-key-label">Language</Box><Box>{str(po.language)}</Box></div>}
              {po.build_system && <div><Box variant="awsui-key-label">Build System</Box><Box>{str(po.build_system)}</Box></div>}
              {po.total_loc && <div><Box variant="awsui-key-label">Total LOC</Box><Box>{str(po.total_loc)}</Box></div>}
              {po.source_files_count && <div><Box variant="awsui-key-label">Source Files</Box><Box>{str(po.source_files_count)}</Box></div>}
              {po.functions_count && <div><Box variant="awsui-key-label">Functions</Box><Box>{str(po.functions_count)}</Box></div>}
              {po.test_coverage && <div><Box variant="awsui-key-label">Test Coverage</Box><Box>{str(po.test_coverage)}</Box></div>}
              {po.third_party_deps_count && <div><Box variant="awsui-key-label">3rd Party Deps</Box><Box>{str(po.third_party_deps_count)}</Box></div>}
            </ColumnLayout>
            {arr(po.strengths).length > 0 && <Box padding={{ top: 's' }}><Box variant="awsui-key-label">Strengths</Box>{po.strengths.map((s: string, i: number) => <Box key={i} variant="small">✓ {s}</Box>)}</Box>}
            {arr(po.areas_for_improvement).length > 0 && <Box padding={{ top: 's' }}><Box variant="awsui-key-label">Areas for Improvement</Box>{po.areas_for_improvement.map((s: string, i: number) => <Box key={i} variant="small">⚠ {s}</Box>)}</Box>}
            {po.aws_recommendation && <Box padding={{ top: 's' }}><Box variant="awsui-key-label">AWS Recommendation</Box><Box>{str(po.aws_recommendation)}</Box></Box>}
          </Container>
        )}

        {/* 2. System Overview */}
        {Object.keys(so).length > 0 && (
          <Container header={<Header variant="h3">System Overview</Header>}>
            {so.description && <Box padding={{ bottom: 's' }}>{str(so.description)}</Box>}
            <ColumnLayout columns={2}>
              {so.architecture_style && <div><Box variant="awsui-key-label">Architecture Style</Box><Box>{str(so.architecture_style)}</Box></div>}
              {so.deployment_model && <div><Box variant="awsui-key-label">Deployment Model</Box><Box>{str(so.deployment_model)}</Box></div>}
            </ColumnLayout>
            {arr(so.key_architectural_decisions).length > 0 && (
              <Box padding={{ top: 's' }}><Box variant="awsui-key-label">Key Architectural Decisions</Box>
                {so.key_architectural_decisions.map((d: string, i: number) => <Box key={i} variant="small">• {d}</Box>)}
              </Box>
            )}
          </Container>
        )}

        {/* Current vs Target State */}
        {(Object.keys(cs).length > 0 || Object.keys(ts).length > 0) && (
          <Container header={<Header variant="h3">Current State vs Target State</Header>}>
            <ColumnLayout columns={2}>
              <div><Box variant="h3" padding={{ bottom: 's' }}>Current</Box>{renderKV(cs, 'Technology')}</div>
              <div><Box variant="h3" padding={{ bottom: 's' }}>Target</Box>{renderKV(ts, 'Technology')}</div>
            </ColumnLayout>
          </Container>
        )}

        {/* 3. Business Logic */}
        {bl.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${bl.length})`}>Business Logic</Header>}>
            <ExpandableSection headerText={`View ${bl.length} modules`} defaultExpanded={bl.length <= 6}>
              {bl.map((m: any, i: number) => (
                <Box key={i} padding={{ vertical: 'xs' }}>
                  <Box fontWeight="bold">{str(m.module_name)}</Box>
                  {arr(m.functions).map((f: any, j: number) => (
                    <Box key={j} variant="small" padding={{ left: 'm' }}>• {str(f.name)} {f.rules_count ? `(${f.rules_count} rules)` : ''} — {str(f.key_behavior)}</Box>
                  ))}
                </Box>
              ))}
            </ExpandableSection>
          </Container>
        )}

        {/* 4. Workflows */}
        {wf.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${wf.length})`}>Workflows</Header>}>
            <ExpandableSection headerText={`View ${wf.length} workflows`} defaultExpanded={wf.length <= 5}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Name', cell: (w: any) => str(w.name), width: 180 },
                { id: 'trigger', header: 'Trigger', cell: (w: any) => str(w.trigger), width: 120 },
                { id: 'entry', header: 'Entry Point', cell: (w: any) => str(w.entry_point), width: 150 },
                { id: 'desc', header: 'Description', cell: (w: any) => str(w.description), width: 250 },
              ]} items={wf} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 5–7. Diagrams: System Context, Component, Sequence */}
        {renderDiagramSection(repo.system_context_diagram, 'System Context Diagram')}
        {renderDiagramSection(repo.component_diagram, 'Component Diagram')}
        {renderDiagramSection(repo.sequence_diagram, 'Sequence Diagram')}

        {/* 8. Security Patterns */}
        {Object.keys(sp).length > 0 && (
          <Container header={<Header variant="h3">Security Patterns</Header>}>
            <ColumnLayout columns={4}>
              <div><Box variant="awsui-key-label">Risk Level</Box><Box fontSize="heading-l">{str(sp.overall_risk_level)}</Box></div>
              <div><Box variant="awsui-key-label">IAM Violations</Box><Box fontSize="heading-l" color="text-status-error">{str(sp.iam_violations_count || sp.iam_violations || 0)}</Box></div>
              <div><Box variant="awsui-key-label">EOL Components</Box><Box fontSize="heading-l" color="text-status-error">{str(sp.eol_component_count || sp.eol_count || 0)}</Box></div>
              <div><Box variant="awsui-key-label">Credential Issues</Box><Box fontSize="heading-l" color="text-status-warning">{arr(sp.credential_issues).length}</Box></div>
            </ColumnLayout>
            {arr(sp.concerns).length > 0 && (
              <ExpandableSection headerText={`Security Concerns (${sp.concerns.length})`}>
                <Table columnDefinitions={[
                  { id: 'name', header: 'Name', cell: (c: any) => str(c.name), width: 180 },
                  { id: 'severity', header: 'Severity', cell: (c: any) => <Badge color={str(c.severity).includes('high') || str(c.severity).includes('critical') ? 'red' : 'blue'}>{str(c.severity)}</Badge>, width: 100 },
                  { id: 'location', header: 'Location', cell: (c: any) => str(c.location), width: 150 },
                  { id: 'mitigation', header: 'Mitigation', cell: (c: any) => str(c.mitigation), width: 250 },
                ]} items={sp.concerns} variant="embedded" wrapLines />
              </ExpandableSection>
            )}
            {arr(sp.secure_patterns).length > 0 && (
              <ExpandableSection headerText={`Secure Patterns (${sp.secure_patterns.length})`}>
                <Table columnDefinitions={[
                  { id: 'name', header: 'Pattern', cell: (p: any) => str(p.name), width: 200 },
                  { id: 'location', header: 'Location', cell: (p: any) => str(p.location), width: 200 },
                  { id: 'desc', header: 'Description', cell: (p: any) => str(p.description), width: 300 },
                ]} items={sp.secure_patterns} variant="embedded" wrapLines />
              </ExpandableSection>
            )}
          </Container>
        )}

        {/* 9. Components */}
        {comps.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${comps.length})`}>Components</Header>}>
            <ExpandableSection headerText={`View ${comps.length} components`} defaultExpanded={comps.length <= 8}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Name', cell: (c: any) => str(c.name), width: 180 },
                { id: 'type', header: 'Type', cell: (c: any) => <Badge>{str(c.type)}</Badge>, width: 120 },
                { id: 'lang', header: 'Language', cell: (c: any) => str(c.language), width: 100 },
                { id: 'file', header: 'Source File', cell: (c: any) => str(c.source_file), width: 200 },
                { id: 'desc', header: 'Description', cell: (c: any) => str(c.description), width: 200 },
              ]} items={comps} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 10. Design Patterns */}
        {patterns.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${patterns.length})`}>Design Patterns</Header>}>
            <ExpandableSection headerText={`View ${patterns.length} patterns`} defaultExpanded={patterns.length <= 6}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Pattern', cell: (p: any) => str(p.name), width: 180 },
                { id: 'category', header: 'Category', cell: (p: any) => <Badge>{str(p.category)}</Badge>, width: 120 },
                { id: 'location', header: 'Location', cell: (p: any) => str(p.location), width: 200 },
                { id: 'rationale', header: 'Rationale', cell: (p: any) => str(p.rationale), width: 250 },
              ]} items={patterns} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 11. Dependencies */}
        {deps.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${deps.length})`}>Dependencies</Header>}>
            <ExpandableSection headerText={`View all ${deps.length} dependencies`} defaultExpanded={deps.length <= 10}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Name', cell: (d: any) => str(d.name || d.artifact), width: 200 },
                { id: 'version', header: 'Version', cell: (d: any) => str(d.version), width: 120 },
                { id: 'latest', header: 'Latest', cell: (d: any) => str(d.latest_version || d.latest), width: 120 },
                { id: 'health', header: 'Health', cell: (d: any) => {
                  const h = str(d.health || d.status).toLowerCase()
                  const type = h.includes('critical') || h.includes('eol') ? 'error' : h.includes('outdated') ? 'warning' : 'success'
                  return <StatusIndicator type={type}>{str(d.health || d.status || 'Unknown')}</StatusIndicator>
                }, width: 130 },
                { id: 'category', header: 'Category', cell: (d: any) => <Badge>{str(d.category || 'other')}</Badge>, width: 120 },
              ]} items={deps} variant="embedded" />
            </ExpandableSection>
          </Container>
        )}

        {/* 12. Program Structure */}
        {Object.keys(ps).length > 0 && (
          <Container header={<Header variant="h3">Program Structure</Header>}>
            <SpaceBetween size="s">
              {arr(ps.modules).length > 0 && (
                <ExpandableSection headerText={`Modules (${ps.modules.length})`} defaultExpanded>
                  {ps.modules.map((m: any, i: number) => (
                    <Box key={i} padding={{ vertical: 'xxs' }}>
                      <Box fontWeight="bold">{str(m.name)} <Box variant="small" display="inline" color="text-body-secondary">{str(m.path)}</Box></Box>
                      {m.description && <Box variant="small">{str(m.description)}</Box>}
                    </Box>
                  ))}
                </ExpandableSection>
              )}
              {arr(ps.entry_points).length > 0 && (
                <ExpandableSection headerText={`Entry Points (${ps.entry_points.length})`}>
                  <Table columnDefinitions={[
                    { id: 'name', header: 'Name', cell: (e: any) => str(e.name), width: 200 },
                    { id: 'file', header: 'File', cell: (e: any) => str(e.file), width: 250 },
                    { id: 'desc', header: 'Description', cell: (e: any) => str(e.description), width: 300 },
                  ]} items={ps.entry_points} variant="embedded" wrapLines />
                </ExpandableSection>
              )}
            </SpaceBetween>
          </Container>
        )}

        {/* 13. Interfaces */}
        {ifaces.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${ifaces.length})`}>Interfaces</Header>}>
            <ExpandableSection headerText={`View ${ifaces.length} interfaces`} defaultExpanded={ifaces.length <= 8}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Name', cell: (i: any) => str(i.name), width: 180 },
                { id: 'sig', header: 'Signature', cell: (i: any) => <Box variant="code">{str(i.signature)}</Box>, width: 250 },
                { id: 'file', header: 'File', cell: (i: any) => str(i.file), width: 200 },
                { id: 'desc', header: 'Description', cell: (i: any) => str(i.description), width: 200 },
              ]} items={ifaces} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 14. Data Models */}
        {dm.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${dm.length})`}>Data Models</Header>}>
            <ExpandableSection headerText={`View ${dm.length} data models`} defaultExpanded={dm.length <= 6}>
              {dm.map((m: any, i: number) => (
                <Box key={i} padding={{ vertical: 'xs' }}>
                  <Box fontWeight="bold">{str(m.name)} <Badge>{str(m.type)}</Badge> {m.file && <Box variant="small" display="inline" color="text-body-secondary">{str(m.file)}</Box>}</Box>
                  {arr(m.fields).length > 0 && (
                    <Table columnDefinitions={[
                      { id: 'name', header: 'Field', cell: (f: any) => str(f.name), width: 150 },
                      { id: 'type', header: 'Type', cell: (f: any) => <Box variant="code">{str(f.type)}</Box>, width: 150 },
                      { id: 'desc', header: 'Description', cell: (f: any) => str(f.description), width: 300 },
                    ]} items={m.fields} variant="embedded" wrapLines />
                  )}
                </Box>
              ))}
            </ExpandableSection>
          </Container>
        )}

        {/* 15. API Reference */}
        {apiRef.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${apiRef.length})`}>API Reference</Header>}>
            <ExpandableSection headerText={`View ${apiRef.length} APIs`} defaultExpanded={apiRef.length <= 8}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Name', cell: (a: any) => str(a.name), width: 180 },
                { id: 'sig', header: 'Signature', cell: (a: any) => <Box variant="code">{str(a.signature)}</Box>, width: 250 },
                { id: 'file', header: 'File', cell: (a: any) => str(a.file), width: 150 },
                { id: 'desc', header: 'Description', cell: (a: any) => str(a.description), width: 200 },
              ]} items={apiRef} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 16. Decision Logic */}
        {dl.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${dl.length})`}>Decision Logic</Header>}>
            <ExpandableSection headerText={`View ${dl.length} decision points`} defaultExpanded={dl.length <= 6}>
              <Table columnDefinitions={[
                { id: 'location', header: 'Location', cell: (d: any) => str(d.location), width: 200 },
                { id: 'condition', header: 'Condition', cell: (d: any) => <Box variant="code">{str(d.condition)}</Box>, width: 200 },
                { id: 'true', header: 'True Branch', cell: (d: any) => str(d.true_branch), width: 150 },
                { id: 'false', header: 'False Branch', cell: (d: any) => str(d.false_branch), width: 150 },
              ]} items={dl} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 17. Error Handling */}
        {Object.keys(eh).length > 0 && (
          <Container header={<Header variant="h3">Error Handling</Header>}>
            <SpaceBetween size="s">
              {arr(eh.patterns).length > 0 && (
                <ExpandableSection headerText={`Patterns (${eh.patterns.length})`} defaultExpanded>
                  <Table columnDefinitions={[
                    { id: 'pattern', header: 'Pattern', cell: (p: any) => str(p.pattern), width: 200 },
                    { id: 'location', header: 'Location', cell: (p: any) => str(p.location), width: 200 },
                    { id: 'desc', header: 'Description', cell: (p: any) => str(p.description), width: 300 },
                  ]} items={eh.patterns} variant="embedded" wrapLines />
                </ExpandableSection>
              )}
              {arr(eh.error_codes).length > 0 && (
                <ExpandableSection headerText={`Error Codes (${eh.error_codes.length})`}>
                  <Table columnDefinitions={[
                    { id: 'code', header: 'Code', cell: (c: any) => <Box variant="code">{str(c.code)}</Box>, width: 150 },
                    { id: 'meaning', header: 'Meaning', cell: (c: any) => str(c.meaning), width: 400 },
                  ]} items={eh.error_codes} variant="embedded" wrapLines />
                </ExpandableSection>
              )}
              {arr(eh.recovery_strategies).length > 0 && (
                <Box><Box variant="awsui-key-label">Recovery Strategies</Box>
                  {eh.recovery_strategies.map((s: any, i: number) => <Box key={i} variant="small">• {typeof s === 'string' ? s : str(s)}</Box>)}
                </Box>
              )}
            </SpaceBetween>
          </Container>
        )}

        {/* 18. Code Metrics */}
        {Object.keys(cm).length > 0 && (
          <Container header={<Header variant="h3">Code Metrics</Header>}>
            <ColumnLayout columns={4}>
              {cm.total_loc != null && <div><Box variant="awsui-key-label">Total LOC</Box><Box fontSize="heading-l">{str(cm.total_loc)}</Box></div>}
              {cm.source_files != null && <div><Box variant="awsui-key-label">Source Files</Box><Box fontSize="heading-l">{str(cm.source_files)}</Box></div>}
              {cm.functions != null && <div><Box variant="awsui-key-label">Functions</Box><Box fontSize="heading-l">{str(cm.functions)}</Box></div>}
              {cm.modules != null && <div><Box variant="awsui-key-label">Modules</Box><Box fontSize="heading-l">{str(cm.modules)}</Box></div>}
              {cm.max_cyclomatic_complexity != null && <div><Box variant="awsui-key-label">Max Cyclomatic</Box><Box fontSize="heading-l">{str(cm.max_cyclomatic_complexity)}</Box></div>}
              {cm.avg_cyclomatic_complexity != null && <div><Box variant="awsui-key-label">Avg Cyclomatic</Box><Box fontSize="heading-l">{str(cm.avg_cyclomatic_complexity)}</Box></div>}
              {cm.test_coverage_percent != null && <div><Box variant="awsui-key-label">Test Coverage</Box><Box fontSize="heading-l">{str(cm.test_coverage_percent)}%</Box></div>}
            </ColumnLayout>
          </Container>
        )}

        {/* 19. Complexity Analysis */}
        {Object.keys(ca).length > 0 && (
          <Container header={<Header variant="h3">Complexity Analysis</Header>}>
            <ColumnLayout columns={4}>
              <div><Box variant="awsui-key-label">Overall</Box><Box fontSize="heading-l">{str(ca.overall_rating || ca.overall)}</Box></div>
              <div><Box variant="awsui-key-label">Cyclomatic Avg</Box><Box fontSize="heading-l">{str(ca.cyclomatic_complexity_avg || ca.cyclomatic_avg)}</Box></div>
              <div><Box variant="awsui-key-label">Coupling</Box><Box fontSize="heading-l">{str(ca.coupling_level || ca.coupling)}</Box></div>
              <div><Box variant="awsui-key-label">Infrastructure</Box><Box fontSize="heading-l">{str(ca.infrastructure_complexity || ca.infrastructure)}</Box></div>
            </ColumnLayout>
            {arr(ca.hotspots).length > 0 && (
              <ExpandableSection headerText={`Hotspots (${ca.hotspots.length})`}>
                <Table columnDefinitions={[
                  { id: 'file', header: 'File', cell: (h: any) => str(h.file), width: 250 },
                  { id: 'complexity', header: 'Complexity', cell: (h: any) => str(h.complexity), width: 100 },
                  { id: 'reason', header: 'Reason', cell: (h: any) => str(h.reason), width: 300 },
                ]} items={ca.hotspots} variant="embedded" wrapLines />
              </ExpandableSection>
            )}
          </Container>
        )}

        {/* 20. Dependency Analysis */}
        {Object.keys(da).length > 0 && (
          <Container header={<Header variant="h3">Dependency Analysis</Header>}>
            <ColumnLayout columns={3}>
              {da.total_deps != null && <div><Box variant="awsui-key-label">Total</Box><Box fontSize="heading-l">{str(da.total_deps)}</Box></div>}
              {da.direct_deps != null && <div><Box variant="awsui-key-label">Direct</Box><Box fontSize="heading-l">{str(da.direct_deps)}</Box></div>}
              {da.transitive_deps != null && <div><Box variant="awsui-key-label">Transitive</Box><Box fontSize="heading-l">{str(da.transitive_deps)}</Box></div>}
            </ColumnLayout>
            {da.risk_assessment && <Box padding={{ top: 's' }}><Box variant="awsui-key-label">Risk Assessment</Box><Box>{str(da.risk_assessment)}</Box></Box>}
            {da.dependency_graph_description && <Box padding={{ top: 's' }}><Box variant="awsui-key-label">Graph</Box><Box variant="small">{str(da.dependency_graph_description)}</Box></Box>}
          </Container>
        )}

        {/* 21. Component Order */}
        {co.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${co.length})`}>Component Migration Order</Header>}>
            <Table columnDefinitions={[
              { id: 'order', header: '#', cell: (c: any) => str(c.order), width: 50 },
              { id: 'name', header: 'Component', cell: (c: any) => str(c.name), width: 200 },
              { id: 'reason', header: 'Reason', cell: (c: any) => str(c.reason), width: 250 },
              { id: 'deps', header: 'Dependencies', cell: (c: any) => arr(c.dependencies).join(', ') || '-', width: 200 },
            ]} items={co} variant="embedded" wrapLines />
          </Container>
        )}

        {/* 22. Test Specifications */}
        {ts_.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${ts_.length})`}>Test Specifications</Header>}>
            <ExpandableSection headerText={`View ${ts_.length} test specs`} defaultExpanded={ts_.length <= 8}>
              <Table columnDefinitions={[
                { id: 'name', header: 'Name', cell: (t: any) => str(t.name), width: 200 },
                { id: 'type', header: 'Type', cell: (t: any) => <Badge>{str(t.type)}</Badge>, width: 100 },
                { id: 'desc', header: 'Description', cell: (t: any) => str(t.description), width: 250 },
                { id: 'expected', header: 'Expected Result', cell: (t: any) => str(t.expected_result), width: 200 },
              ]} items={ts_} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}

        {/* 23. Validation Criteria */}
        {vc.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${vc.length})`}>Validation Criteria</Header>}>
            <Table columnDefinitions={[
              { id: 'name', header: 'Criteria', cell: (v: any) => str(v.name), width: 200 },
              { id: 'desc', header: 'Description', cell: (v: any) => str(v.description), width: 250 },
              { id: 'condition', header: 'Acceptance Condition', cell: (v: any) => str(v.acceptance_condition), width: 200 },
              { id: 'priority', header: 'Priority', cell: (v: any) => <Badge color={str(v.priority).includes('high') || str(v.priority).includes('critical') ? 'red' : 'blue'}>{str(v.priority)}</Badge>, width: 100 },
            ]} items={vc} variant="embedded" wrapLines />
          </Container>
        )}

        {/* 24. Technical Debt Summary */}
        {Object.keys(tds).length > 0 && (
          <Container header={<Header variant="h3">Technical Debt Summary</Header>}>
            <ColumnLayout columns={4}>
              <div><Box variant="awsui-key-label">Critical</Box><Box fontSize="heading-xl" color="text-status-error">{arr(tds.critical).length || tds.critical || 0}</Box></div>
              <div><Box variant="awsui-key-label">High</Box><Box fontSize="heading-xl" color="text-status-warning">{arr(tds.high).length || tds.high || 0}</Box></div>
              <div><Box variant="awsui-key-label">Medium</Box><Box fontSize="heading-xl">{arr(tds.medium).length || tds.medium || 0}</Box></div>
              <div><Box variant="awsui-key-label">Low</Box><Box fontSize="heading-xl">{arr(tds.low).length || tds.low || 0}</Box></div>
            </ColumnLayout>
            {(() => {
              const allItems = [
                ...arr(tds.critical).map((d: any) => ({ ...d, severity: 'critical' })),
                ...arr(tds.high).map((d: any) => ({ ...d, severity: 'high' })),
                ...arr(tds.medium).map((d: any) => ({ ...d, severity: 'medium' })),
                ...arr(tds.low).map((d: any) => ({ ...d, severity: 'low' })),
                ...arr(tds.items),
              ]
              return allItems.length > 0 ? (
                <ExpandableSection headerText={`Debt Items (${allItems.length})`}>
                  <Table columnDefinitions={[
                    { id: 'item', header: 'Item', cell: (d: any) => str(d.item || d.name), width: 250 },
                    { id: 'severity', header: 'Severity', cell: (d: any) => <Badge color={str(d.severity).includes('critical') || str(d.severity).includes('high') ? 'red' : 'blue'}>{str(d.severity)}</Badge>, width: 100 },
                    { id: 'component', header: 'Component', cell: (d: any) => str(d.component), width: 200 },
                    { id: 'remediation', header: 'Remediation', cell: (d: any) => str(d.remediation), width: 250 },
                  ]} items={allItems} variant="embedded" />
                </ExpandableSection>
              ) : null
            })()}
          </Container>
        )}

        {/* 25. Technical Debt Report */}
        {Object.keys(tdr).length > 0 && (
          <Container header={<Header variant="h3">Technical Debt Report</Header>}>
            {tdr.overview && <Box padding={{ bottom: 's' }}>{str(tdr.overview)}</Box>}
            <ColumnLayout columns={3}>
              {tdr.total_items != null && <div><Box variant="awsui-key-label">Total Items</Box><Box fontSize="heading-l">{str(tdr.total_items)}</Box></div>}
              {tdr.by_severity && <div><Box variant="awsui-key-label">By Severity</Box>{renderKV(tdr.by_severity, 'Severity')}</div>}
            </ColumnLayout>
            {arr(tdr.top_items).length > 0 && (
              <ExpandableSection headerText={`Top Items (${tdr.top_items.length})`}>
                <Table columnDefinitions={[
                  { id: 'item', header: 'Item', cell: (t: any) => str(t.item), width: 250 },
                  { id: 'severity', header: 'Severity', cell: (t: any) => <Badge color={str(t.severity).includes('critical') || str(t.severity).includes('high') ? 'red' : 'blue'}>{str(t.severity)}</Badge>, width: 100 },
                  { id: 'component', header: 'Component', cell: (t: any) => str(t.component), width: 200 },
                  { id: 'remediation', header: 'Remediation', cell: (t: any) => str(t.remediation), width: 250 },
                ]} items={tdr.top_items} variant="embedded" wrapLines />
              </ExpandableSection>
            )}
          </Container>
        )}

        {/* 26. Outdated Components */}
        {oc.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${oc.length})`}>Outdated Components</Header>}>
            <Table columnDefinitions={[
              { id: 'name', header: 'Name', cell: (o: any) => str(o.name), width: 200 },
              { id: 'current', header: 'Current', cell: (o: any) => str(o.current_version), width: 120 },
              { id: 'latest', header: 'Latest', cell: (o: any) => str(o.latest_version), width: 120 },
              { id: 'severity', header: 'Severity', cell: (o: any) => <Badge color={str(o.severity).includes('critical') || str(o.severity).includes('high') ? 'red' : 'blue'}>{str(o.severity)}</Badge>, width: 100 },
              { id: 'fix', header: 'Remediation', cell: (o: any) => str(o.remediation), width: 250 },
            ]} items={oc} variant="embedded" wrapLines />
          </Container>
        )}

        {/* 27. Maintenance Burden */}
        {Object.keys(mb).length > 0 && (
          <Container header={<Header variant="h3">Maintenance Burden</Header>}>
            {mb.overall_assessment && <Box padding={{ bottom: 's' }}>{str(mb.overall_assessment)}</Box>}
            {mb.estimated_effort && <Box><Box variant="awsui-key-label">Estimated Effort</Box><Box>{str(mb.estimated_effort)}</Box></Box>}
            {arr(mb.key_concerns).length > 0 && (
              <Box padding={{ top: 's' }}><Box variant="awsui-key-label">Key Concerns</Box>
                {mb.key_concerns.map((c: any, i: number) => <Box key={i} variant="small">⚠ {typeof c === 'string' ? c : str(c)}</Box>)}
              </Box>
            )}
          </Container>
        )}

        {/* 28. Remediation Plan */}
        {rp.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${rp.length})`}>Remediation Plan</Header>}>
            <Table columnDefinitions={[
              { id: 'item', header: 'Item', cell: (r: any) => str(r.item), width: 250 },
              { id: 'priority', header: 'Priority', cell: (r: any) => <Badge color={str(r.priority).includes('high') || str(r.priority).includes('critical') ? 'red' : 'blue'}>{str(r.priority)}</Badge>, width: 100 },
              { id: 'effort', header: 'Effort', cell: (r: any) => str(r.effort), width: 100 },
              { id: 'desc', header: 'Description', cell: (r: any) => str(r.description), width: 250 },
            ]} items={rp} variant="embedded" wrapLines />
          </Container>
        )}

        {/* Migration Plan (additional) */}
        {plan.length > 0 && (
          <Container header={<Header variant="h3">Migration Plan</Header>}>
            <Table columnDefinitions={[
              { id: 'phase', header: 'Phase', cell: (p: any) => str(p.phase_name || p.phase || p.name), width: 200 },
              { id: 'priority', header: 'Priority', cell: (p: any) => <Badge color={str(p.priority).includes('critical') || str(p.priority).includes('high') ? 'red' : 'blue'}>{str(p.priority)}</Badge>, width: 100 },
              { id: 'items', header: 'Items', cell: (p: any) => str(typeof p.items === 'number' ? p.items : arr(p.items).length || '-'), width: 80 },
              { id: 'effort', header: 'Effort', cell: (p: any) => str(p.estimated_effort || p.effort), width: 120 },
              { id: 'deps', header: 'Dependencies', cell: (p: any) => arr(p.dependencies).join(', ') || '-', width: 200 },
            ]} items={plan} variant="embedded" />
          </Container>
        )}

        {/* Breaking Changes (additional) */}
        {bc.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${bc.length})`}>Breaking Changes</Header>}>
            <Table columnDefinitions={[
              { id: 'change', header: 'Change', cell: (c: any) => str(c.change), width: 250 },
              { id: 'impact', header: 'Impact', cell: (c: any) => str(c.impact), width: 200 },
              { id: 'files', header: 'Affected Files', cell: (c: any) => arr(c.affected_files).join(', ') || '-', width: 200 },
              { id: 'fix', header: 'Remediation', cell: (c: any) => str(c.remediation), width: 200 },
            ]} items={bc} variant="embedded" wrapLines />
          </Container>
        )}

        {/* Architecture Diagrams (all collected) */}
        {diagrams.length > 0 && (
          <Container header={<Header variant="h3">Architecture Diagrams</Header>}>
            <Tabs tabs={diagrams.map((d: string, i: number) => ({
              id: `diagram-${i}`, label: `Diagram ${i + 1}`,
              content: <MermaidDiagram chart={typeof d === 'string' ? d : JSON.stringify(d)} />
            }))} />
          </Container>
        )}

        {/* API Surface, Data Stores, Deployment Topology (additional) */}
        {apiSurf.length > 0 && (
          <Container header={<Header variant="h3" counter={`(${apiSurf.length})`}>API Surface</Header>}>
            <ExpandableSection headerText={`View ${apiSurf.length} endpoints`} defaultExpanded={apiSurf.length <= 10}>
              <Table columnDefinitions={[
                { id: 'method', header: 'Method', cell: (a: any) => <Badge>{str(a.method)}</Badge>, width: 80 },
                { id: 'path', header: 'Path', cell: (a: any) => str(a.path), width: 250 },
                { id: 'desc', header: 'Description', cell: (a: any) => str(a.description), width: 300 },
              ]} items={apiSurf} variant="embedded" wrapLines />
            </ExpandableSection>
          </Container>
        )}
        {ds.length > 0 && (
          <Container header={<Header variant="h3">Data Stores</Header>}>
            <Table columnDefinitions={[
              { id: 'type', header: 'Type', cell: (d: any) => str(d.type), width: 120 },
              { id: 'tech', header: 'Technology', cell: (d: any) => str(d.technology), width: 150 },
              { id: 'purpose', header: 'Purpose', cell: (d: any) => str(d.purpose), width: 200 },
              { id: 'impact', header: 'Migration Impact', cell: (d: any) => str(d.migration_impact), width: 200 },
            ]} items={ds} variant="embedded" wrapLines />
          </Container>
        )}
        {deployTopo && (
          <Container header={<Header variant="h3">Deployment Topology</Header>}>
            <Box>{typeof deployTopo === 'string' ? deployTopo : JSON.stringify(deployTopo, null, 2)}</Box>
          </Container>
        )}
      </SpaceBetween>
    )
  }

  // Build repo tabs with lazy loading
  const repoTabs = repos.map((repo, idx) => ({
    id: repo.repo_name || `repo-${idx}`,
    label: repo.repo_name || `Repo ${idx + 1}`,
    content: renderRepoContent(repo)
  }))

  const hasDependencyData = !!(analysisInfo?.execution_order && analysisInfo.execution_order.length > 0)

  const analysisContent = (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2" description={repos[0]?.run_id ? `Run: ${repos[0].run_id}${analysisInfo?.branch ? ` · Branch: ${analysisInfo.branch}` : ''}` : undefined}>Code Analysis Assessment</Header>}>
        <ColumnLayout columns={4}>
          <div><Box variant="awsui-key-label">Repositories</Box><Box fontSize="heading-xl">{repos.length}</Box></div>
          <div><Box variant="awsui-key-label">Total Dependencies</Box><Box fontSize="heading-xl">{totalDeps}</Box></div>
          <div><Box variant="awsui-key-label">Technical Debt Items</Box><Box fontSize="heading-xl" color="text-status-warning">{totalDebt}</Box></div>
          <div><Box variant="awsui-key-label">Security Vulnerabilities</Box><Box fontSize="heading-xl" color="text-status-error">{totalVulns}</Box></div>
        </ColumnLayout>
      </Container>
      <Tabs activeTabId={activeRepoTab} onChange={({ detail }) => setActiveRepoTab(detail.activeTabId)} tabs={repoTabs} />
    </SpaceBetween>
  )

  const dependenciesContent = (
    <SpaceBetween size="l">
      {analysisInfo?.mermaid_diagram && (
        <Container header={<Header variant="h2">Dependency Graph</Header>}>
          <div style={{ overflow: 'auto', maxWidth: '100%' }}><MermaidDiagram chart={analysisInfo.mermaid_diagram} /></div>
        </Container>
      )}
      <Container header={<Header variant="h2" counter={`(${(analysisInfo?.execution_order || []).length})`}>Repository Overview</Header>}>
        <Table
          columnDefinitions={[
            { id: 'name', header: 'Name', cell: (r: any) => r.name, width: 150 },
            { id: 'role', header: 'Role', cell: (r: any) => r.role || '-', width: 120 },
            { id: 'tech', header: 'Tech Stack', cell: (r: any) => r.tech || '-', width: 180 },
            { id: 'status', header: 'Status', cell: (r: any) => {
              const s = r.status
              if (s === 'completed') return <StatusIndicator type="success">Completed</StatusIndicator>
              if (s === 'failed') return <StatusIndicator type="error">Failed</StatusIndicator>
              if (s === 'analyzing') return <StatusIndicator type="in-progress">Analyzing</StatusIndicator>
              return <StatusIndicator type="pending">Pending</StatusIndicator>
            }, width: 120 },
            { id: 'findings', header: 'Key Findings', cell: (r: any) => r.summary || '-', width: 250 },
          ]}
          items={(analysisInfo?.execution_order || []).map((name: string) => {
            const rs = analysisInfo?.repo_statuses?.[name]
            const status = typeof rs === 'object' ? rs?.status : rs
            const summary = analysisInfo?.repo_summaries?.[name] || ''
            const techMatch = summary.match(/^([^,]+),\s*([^,]+)/)
            return {
              name,
              role: techMatch ? techMatch[2]?.trim() : '-',
              tech: techMatch ? techMatch[1]?.trim() : summary.slice(0, 60) || '-',
              status: status || 'pending',
              summary: summary.slice(0, 120) || '-',
            }
          })}
          variant="embedded" wrapLines
        />
      </Container>
      <Container header={<Header variant="h2">Execution Order</Header>}>
        <ol style={{ margin: '4px 0', paddingLeft: 24 }}>
          {(analysisInfo?.execution_order || []).map((name: string) => (
            <li key={name} style={{ padding: '2px 0', fontSize: 14 }}>{name}</li>
          ))}
        </ol>
      </Container>
    </SpaceBetween>
  )

  if (hasDependencyData) {
    return (
      <Tabs activeTabId={activeMainTab} onChange={({ detail }) => setActiveMainTab(detail.activeTabId)}
        tabs={[
          { id: 'analysis', label: 'Analysis', content: analysisContent },
          { id: 'dependencies', label: 'Dependencies', content: dependenciesContent },
        ]}
      />
    )
  }

  return analysisContent
}
