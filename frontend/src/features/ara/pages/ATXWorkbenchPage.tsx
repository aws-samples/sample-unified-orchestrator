import React, { useState, useEffect } from 'react'
import {
    ContentLayout, Header, Table, Button, SpaceBetween, Box, Badge,
    StatusIndicator, TextFilter, Pagination, Tabs, Flashbar, Modal,
    FormField, Input, Select, Textarea,
    Container, ColumnLayout, Checkbox, Alert
} from '@cloudscape-design/components'
import type { TableProps } from '@cloudscape-design/components'
import apiClient from '../../uno/services/api'
import CodeAnalysisTab from '../components/risk/ATXCodeAnalysisTab'
// import MermaidDiagram from '../components/risk/MermaidDiagram'

// ── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({ text, children, align = 'right' }: { text: string; children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
    const [v, setV] = React.useState(false)
    const pos: React.CSSProperties = align === 'left' ? { left: 0 } : align === 'center' ? { left: '50%', transform: 'translateX(-50%)' } : { right: 0 }
    return (
        <div style={{ position: 'relative', display: 'inline-block' }}
            onMouseEnter={() => setV(true)} onMouseLeave={() => setV(false)}>
            {children}
            <div style={{
                visibility: v ? 'visible' : 'hidden', opacity: v ? 1 : 0, width: 260,
                backgroundColor: '#232f3e', color: '#fff', textAlign: 'center', borderRadius: 4,
                padding: '6px 10px', position: 'absolute', zIndex: 9999, bottom: '120%',
                fontSize: 12, lineHeight: '1.4',
                transition: 'opacity 0.2s', pointerEvents: 'none', whiteSpace: 'normal',
                ...pos
            }}>{text}</div>
        </div>
    )
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Application { application_id: string; application_name: string; WAVE?: string; scm_urls?: string[] }
interface TransformDef { name: string; description: string }
interface TransformStep { transformation: TransformDef | null; contextText: string; selectedNotes: string[] }
const getRepoName = (url: string) => url.split('#')[0].split('/').pop()?.replace('.git', '') || url

// ── Drawer ────────────────────────────────────────────────────────────────────
function AppDrawer({ app, onClose, children }: { app: Application; onClose: () => void; children: React.ReactNode }) {
    return (
        <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 520,
            backgroundColor: 'var(--color-background-container-content, #fff)',
            boxShadow: '-4px 0 16px rgba(0,0,0,0.15)', zIndex: 1000,
            display: 'flex', flexDirection: 'column', overflowY: 'auto'
        }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-divider-default, #e9ebed)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <Box variant="h3">{app.application_name}</Box>
                    <Box variant="small" color="text-body-secondary">{app.application_id}{app.WAVE ? ` · ${app.WAVE}` : ''}</Box>
                </div>
                <Button variant="icon" iconName="close" ariaLabel="Close" onClick={onClose} />
            </div>
            <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>{children}</div>
        </div>
    )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ATXWorkbenchPage() {
    const [applications, setApplications] = useState<Application[]>([])
    const [loading, setLoading] = useState(true)
    const [filterText, setFilterText] = useState('')
    const [filterWave, setFilterWave] = useState<string>('')
    const [currentPage, setCurrentPage] = useState(1)
    const [selectedApp, setSelectedApp] = useState<Application | null>(null)
    const [flashItems, setFlashItems] = useState<any[]>([])
    const [analysisStatuses, setAnalysisStatuses] = useState<Record<string, any>>({})
    const [statusLoading, setStatusLoading] = useState(false)
    const [transformRuns, setTransformRuns] = useState<any[]>([])
    const [_transformRunsLoading, setTransformRunsLoading] = useState(false)
    const [_transformRefreshMsg, setTransformRefreshMsg] = useState('')
    const [activeTab, setActiveTab] = useState('analysis')
    const [submitting, setSubmitting] = useState(false)
    const [_extractingAppId, _setExtractingAppId] = useState<string | null>(null)
    const [extractingTaskId, setExtractingTaskId] = useState<string | null>(null)
    const [analysisBranch, setAnalysisBranch] = useState<string>('')
    const [selectedRepos, setSelectedRepos] = useState<string[]>([])
    const [showCodeAnalysisModal, setShowCodeAnalysisModal] = useState(false)
    const [showTransformAssessmentModal, setShowTransformAssessmentModal] = useState(false)
    const [transformAssessmentData, setTransformAssessmentData] = useState<any[]>([])
    const [transformAssessmentRun, setTransformAssessmentRun] = useState<any>(null)
    const [loadingTransformAssessment, setLoadingTransformAssessment] = useState(false)

    // Transform modal
    const [showTransformModal, setShowTransformModal] = useState(false)
    const [selectedRepoUrl, setSelectedRepoUrl] = useState('')
    const [branchName, setBranchName] = useState('')
    const [pushToRepo, setPushToRepo] = useState(true)
    const [transformDefs, setTransformDefs] = useState<TransformDef[]>([])
    const [steps, setSteps] = useState<TransformStep[]>([{ transformation: null, contextText: '', selectedNotes: [] }])
    const [showReview, setShowReview] = useState(false)

    const [transformWarningDismissed, setTransformWarningDismissed] = useState(false)

    // Notes selection for context
    const [availableNotes, setAvailableNotes] = useState<any[]>([])
    const [selectedNoteKeys, setSelectedNoteKeys] = useState<string[]>([])
    const [analysisRuns, setAnalysisRuns] = useState<any[]>([])
    const [viewingAnalysisRun, setViewingAnalysisRun] = useState<any>(null)

    const PAGE_SIZE = 20
    const flash = (type: string, content: string) =>
        setFlashItems([{ type, content, dismissible: true, onDismiss: () => setFlashItems([]) }])

    // Reset warning dismissal and load notes when app changes
    useEffect(() => { setTransformWarningDismissed(false); setSelectedRepos(selectedApp?.scm_urls || []) }, [selectedApp?.application_id])
    useEffect(() => {
        if (selectedApp) loadNotesForApp(selectedApp)
        else { setAvailableNotes([]); setSelectedNoteKeys([]) }
    }, [selectedApp?.application_id])

    // Load analysis runs for selected app
    useEffect(() => {
        if (selectedApp) {
            apiClient.get(`/ara/atx/tasks?app_id=${selectedApp.application_id}`)
                .then(resp => {
                    const tasks = (resp.data.tasks || []).filter((t: any) => t.task_type !== 'atx_transform')
                    setAnalysisRuns(tasks)
                })
                .catch(() => setAnalysisRuns([]))
        } else { setAnalysisRuns([]) }
    }, [selectedApp?.application_id])

    const loadNotesForApp = async (app: Application) => {
        setSelectedNoteKeys([])
        try {
            const [insightsResp, guidelinesResp] = await Promise.all([
                apiClient.get('/notes/list', { params: { note_type: 'Application Insights', application_name: app.application_name } }).catch(() => ({ data: { notes: [] } })),
                apiClient.get('/notes/list', { params: { note_type: 'ATX Common Guidelines' } }).catch(() => ({ data: { notes: [] } })),
            ])
            const notes = [
                ...(insightsResp.data.notes || []).map((n: any) => ({ ...n, _label: `📋 ${n.filename} (App Insights)` })),
                ...(guidelinesResp.data.notes || []).map((n: any) => ({ ...n, _label: `📘 ${n.filename} (ATX Guidelines)` })),
            ]
            setAvailableNotes(notes)
        } catch { setAvailableNotes([]) }
    }

    useEffect(() => { loadApplications(); loadTransformRuns() }, [])
    useEffect(() => {
        if (applications.length > 0) {
            // Only check status for apps that have SCM repos configured
            const appsWithRepos = applications.filter(a => (a.scm_urls || []).length > 0)
            if (appsWithRepos.length > 0) checkStatuses(appsWithRepos.map(a => a.application_id))
        }
    }, [applications])

    const loadApplications = async () => {
        setLoading(true)
        try {
            const resp = await apiClient.get('/wave/applications?summary=false')
            if (resp.data.success) setApplications(resp.data.data.applications || [])
        } catch (e: any) { flash('error', `Failed to load: ${e.message}`) }
        setLoading(false)
    }

    const checkStatuses = async (ids: string[]) => {
        if (!ids.length) return
        setStatusLoading(true)
        try {
            const resp = await apiClient.post('/ara/atx/status', ids)
            setAnalysisStatuses(resp.data.statuses || {})
        } catch { /* ignore */ }
        setStatusLoading(false)
    }

    const loadTransformRuns = async () => {
        setTransformRunsLoading(true)
        try {
            const resp = await apiClient.get('/ara/atx/transform/tasks')
            if (resp.data.success) {
                const tasks = resp.data.tasks || []
                setTransformRuns(tasks)
                const appTasks = selectedApp ? tasks.filter((t: any) => t.application_id === selectedApp.application_id) : []
                const running = appTasks.filter((t: any) => t.status === 'processing').length
                const completed = appTasks.filter((t: any) => t.status === 'completed').length
                const msg = running > 0 ? `${running} in progress` : completed > 0 ? 'All done' : 'No runs'
                setTransformRefreshMsg(msg)
                setTimeout(() => setTransformRefreshMsg(''), 3000)
            }
        } catch { /* ignore */ }
        setTransformRunsLoading(false)
    }

    // ── Analysis actions ────────────────────────────────────────────────────────
    const submitAnalysis = async (combined = false) => {
        if (!selectedApp) return
        const s = analysisStatuses[selectedApp.application_id]?.status || ''
        if (s === 'in_progress' || s.startsWith('running_atx')) { flash('warning', 'Analysis already in progress'); return }
        if (!selectedApp.scm_urls?.length) { flash('warning', 'No SCM repos configured'); return }
        setSubmitting(true)
        try {
            const endpoint = combined ? '/ara/atx/run-combined' : '/ara/atx/run'
            await apiClient.post(endpoint, {
                application_ids: [selectedApp.application_id],
                branch: analysisBranch.trim() || undefined,
                selected_repos: { [selectedApp.application_id]: selectedRepos },
                selected_files: selectedNoteKeys.length > 0 ? { [selectedApp.application_id]: selectedNoteKeys } : undefined,
            })
            setAnalysisStatuses(prev => ({ ...prev, [selectedApp.application_id]: { status: 'in_progress', total_repos: selectedApp.scm_urls?.length || 0, completed_repos: 0, failed_repos: 0 } }))
            flash('info', combined ? 'Combined analysis launched' : 'Analysis launched')
        } catch (e: any) { flash('error', `Failed: ${e.response?.data?.detail || e.message}`) }
        setSubmitting(false)
    }

    const viewAnalysis = async (run?: any) => {
        if (!selectedApp) return
        const taskId = run?.task_id || ''
        const runId = run?.run_id || ''
        setViewingAnalysisRun(run || null)
        setExtractingTaskId(taskId)
        try {
            const resp = await apiClient.get(`/ara/atx/applications/${selectedApp.application_id}?include=assessments`)
            if (resp.data.data?.assessments?.repos?.length || (Array.isArray(resp.data.data?.assessments) && resp.data.data.assessments.length)) {
                setShowCodeAnalysisModal(true); setExtractingTaskId(null); return
            }
            // No assessment yet — trigger extraction and wait
            flash('info', 'Extracting assessment — this may take a moment...')
            const extractUrl = runId
                ? `/ara/atx/extract/${selectedApp.application_id}?run_id=${runId}`
                : `/ara/atx/extract/${selectedApp.application_id}`
            await apiClient.post(extractUrl)
            setShowCodeAnalysisModal(true)
        } catch (e: any) { flash('error', `Failed: ${e.message}`) }
        setExtractingTaskId(null)
    }

    const downloadAssessment = async (appId: string, type: 'analysis' | 'transformation', format: 'json' | 'html' = 'json') => {
        try {
            let data: any
            if (type === 'analysis') {
                const resp = await apiClient.get(`/ara/atx/applications/${appId}?include=assessments`)
                data = resp.data.data?.assessments
            } else {
                data = transformAssessmentData
            }
            if (!data || (Array.isArray(data) && !data.length)) { flash('warning', 'No assessment data to download'); return }

            const filename = `${appId}_${type === 'analysis' ? 'code_analysis' : 'transformation_assessment'}`

            if (format === 'json') {
                // JSON: include all assessment data as-is
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = `${filename}.json`; a.click()
                window.URL.revokeObjectURL(url)
            } else {
                // Generate HTML report with all fields
                const title = type === 'analysis' ? 'Code Analysis Report' : 'Transformation Assessment Report'
                const repos = data?.repos || (Array.isArray(data) ? data : [data])
                let sections = ''
                for (const repo of repos) {
                    const name = repo.repo_name || repo.transformation_name || 'Assessment'
                    sections += `<h2>${name}</h2>`

                    // Summary
                    const summary = repo.summary || repo.executive_summary
                    if (summary) sections += `<div class="summary"><h3>Summary</h3><p>${summary}</p></div>`

                    // System Overview
                    if (repo.system_overview) {
                        const so = repo.system_overview
                        sections += `<h3>System Overview</h3><ul>`
                        if (so.description) sections += `<li><b>Description:</b> ${so.description}</li>`
                        if (so.architecture_style) sections += `<li><b>Architecture:</b> ${so.architecture_style}</li>`
                        if (so.deployment_model) sections += `<li><b>Deployment:</b> ${so.deployment_model}</li>`
                        if (so.aws_recommendation) sections += `<li><b>AWS Recommendation:</b> ${so.aws_recommendation}</li>`
                        if (so.technology_stack) {
                            const ts = so.technology_stack
                            if (ts.languages?.length) sections += `<li><b>Languages:</b> ${ts.languages.join(', ')}</li>`
                            if (ts.frameworks?.length) sections += `<li><b>Frameworks:</b> ${ts.frameworks.join(', ')}</li>`
                            if (ts.build_tools?.length) sections += `<li><b>Build Tools:</b> ${ts.build_tools.join(', ')}</li>`
                            if (ts.servers?.length) sections += `<li><b>Servers:</b> ${ts.servers.join(', ')}</li>`
                            if (ts.databases?.length) sections += `<li><b>Databases:</b> ${ts.databases.join(', ')}</li>`
                        }
                        sections += `</ul>`
                    }

                    // Current State (fallback if no system_overview)
                    if (!repo.system_overview && repo.current_state) {
                        const cs = repo.current_state
                        sections += `<h3>Current State</h3><ul>`
                        if (cs.languages?.length) sections += `<li><b>Languages:</b> ${cs.languages.join(', ')}</li>`
                        if (cs.frameworks?.length) sections += `<li><b>Frameworks:</b> ${cs.frameworks.join(', ')}</li>`
                        if (cs.build_tools?.length) sections += `<li><b>Build Tools:</b> ${cs.build_tools.join(', ')}</li>`
                        if (cs.servers?.length) sections += `<li><b>Servers:</b> ${cs.servers.join(', ')}</li>`
                        if (cs.databases?.length) sections += `<li><b>Databases:</b> ${cs.databases.join(', ')}</li>`
                        if (cs.infrastructure?.length) sections += `<li><b>Infrastructure:</b> ${cs.infrastructure.join(', ')}</li>`
                        if (cs.deployment_model) sections += `<li><b>Deployment:</b> ${cs.deployment_model}</li>`
                        sections += `</ul>`
                    }

                    // Target State
                    if (repo.target_state) {
                        const ts = repo.target_state
                        sections += `<h3>Target State</h3>`
                        if (ts.transformation_type) sections += `<p><b>Transformation:</b> ${ts.transformation_type}</p>`
                        if (ts.migration_path) sections += `<p><b>Migration Path:</b> ${ts.migration_path}</p>`
                        if (ts.recommended_versions?.length) {
                            sections += `<table><tr><th>Component</th><th>From</th><th>To</th></tr>`
                            for (const v of ts.recommended_versions) sections += `<tr><td>${v.component}</td><td>${v.from_version || '-'}</td><td>${v.to_version || '-'}</td></tr>`
                            sections += `</table>`
                        }
                    }

                    // Complexity
                    if (repo.complexity) {
                        const cx = repo.complexity
                        sections += `<h3>Complexity</h3><ul>`
                        if (cx.overall_rating) sections += `<li><b>Overall Rating:</b> ${cx.overall_rating}</li>`
                        if (cx.cyclomatic_complexity_avg) sections += `<li><b>Cyclomatic Complexity (avg):</b> ${cx.cyclomatic_complexity_avg}</li>`
                        if (cx.coupling_level) sections += `<li><b>Coupling Level:</b> ${cx.coupling_level}</li>`
                        if (cx.code_lines) sections += `<li><b>Lines of Code:</b> ${cx.code_lines.toLocaleString()}</li>`
                        sections += `</ul>`
                    }

                    // Component Inventory
                    if (repo.component_inventory?.length) {
                        sections += `<h3>Component Inventory (${repo.component_inventory.length})</h3><table><tr><th>Name</th><th>Type</th><th>Language</th><th>Description</th></tr>`
                        for (const c of repo.component_inventory) sections += `<tr><td>${c.name}</td><td>${c.type || '-'}</td><td>${c.language || '-'}</td><td>${c.description || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Dependencies
                    if (repo.dependencies?.length) {
                        sections += `<h3>Dependencies (${repo.dependencies.length})</h3><table><tr><th>Name</th><th>Version</th><th>Latest</th><th>Health</th><th>Category</th></tr>`
                        for (const d of repo.dependencies) sections += `<tr><td>${d.name}</td><td>${d.version || '-'}</td><td>${d.latest_version || '-'}</td><td>${d.health || '-'}</td><td>${d.category || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Outdated Components
                    if (repo.outdated_components?.length) {
                        sections += `<h3>Outdated Components (${repo.outdated_components.length})</h3><table><tr><th>Name</th><th>Current</th><th>Latest</th><th>Severity</th><th>Remediation</th></tr>`
                        for (const o of repo.outdated_components) sections += `<tr><td>${o.name}</td><td>${o.current_version || '-'}</td><td>${o.latest_version || '-'}</td><td>${o.severity || '-'}</td><td>${o.remediation || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Data Stores
                    if (repo.data_stores?.length) {
                        sections += `<h3>Data Stores (${repo.data_stores.length})</h3><table><tr><th>Type</th><th>Technology</th><th>Purpose</th><th>Migration Impact</th></tr>`
                        for (const ds of repo.data_stores) sections += `<tr><td>${ds.type || '-'}</td><td>${ds.technology || '-'}</td><td>${ds.purpose || '-'}</td><td>${ds.migration_impact || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Security
                    if (repo.security) {
                        sections += `<h3>Security</h3><ul>`
                        if (repo.security.iam_violations_count) sections += `<li><b>IAM Violations:</b> ${repo.security.iam_violations_count}</li>`
                        if (repo.security.eol_component_count) sections += `<li><b>EOL Components:</b> ${repo.security.eol_component_count}</li>`
                        if (repo.security.credential_issues?.length) sections += `<li><b>Credential Issues:</b> ${repo.security.credential_issues.join(', ')}</li>`
                        if (repo.security.network_gaps?.length) sections += `<li><b>Network Gaps:</b> ${repo.security.network_gaps.join(', ')}</li>`
                        if (repo.security.vulnerabilities_by_severity?.length) {
                            sections += `<li><b>Vulnerabilities:</b> ${repo.security.vulnerabilities_by_severity.map((v: any) => `${v.severity}: ${v.count}`).join(', ')}</li>`
                        }
                        sections += `</ul>`
                    }

                    // Breaking Changes
                    if (repo.breaking_changes?.length) {
                        sections += `<h3>Breaking Changes (${repo.breaking_changes.length})</h3><table><tr><th>Change</th><th>Severity</th><th>Impact</th><th>Remediation</th></tr>`
                        for (const b of repo.breaking_changes) sections += `<tr><td>${b.change}</td><td>${b.severity || '-'}</td><td>${b.impact}</td><td>${b.remediation || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Technical Debt
                    if (repo.technical_debt) {
                        const td = repo.technical_debt
                        for (const severity of ['critical', 'high', 'medium', 'low']) {
                            const items = td[severity] || []
                            if (items.length) {
                                sections += `<h3>Technical Debt — ${severity.toUpperCase()} (${items.length})</h3><table><tr><th>Item</th><th>Component</th><th>Category</th><th>Remediation</th></tr>`
                                for (const item of items) sections += `<tr><td>${item.item}</td><td>${item.component || '-'}</td><td>${item.category || '-'}</td><td>${item.remediation || '-'}</td></tr>`
                                sections += `</table>`
                            }
                        }
                    }

                    // Component Migration Order
                    if (repo.component_order?.length) {
                        sections += `<h3>Component Migration Order</h3><table><tr><th>#</th><th>Component</th><th>Reason</th><th>Dependencies</th></tr>`
                        for (const c of repo.component_order) sections += `<tr><td>${c.order || '-'}</td><td>${c.name}</td><td>${c.reason || '-'}</td><td>${(c.dependencies || []).join(', ') || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Migration Plan
                    if (repo.migration_plan?.length) {
                        sections += `<h3>Migration Plan</h3><table><tr><th>Phase</th><th>Priority</th><th>Items</th><th>Effort</th><th>Dependencies</th></tr>`
                        for (const p of repo.migration_plan) sections += `<tr><td>${p.phase_name}</td><td>${p.priority || '-'}</td><td>${p.items || '-'}</td><td>${p.estimated_effort || '-'}</td><td>${(p.dependencies || []).join(', ') || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Test Specifications
                    if (repo.test_specifications?.length) {
                        sections += `<h3>Test Specifications (${repo.test_specifications.length})</h3><table><tr><th>Name</th><th>Type</th><th>Description</th><th>Expected Result</th></tr>`
                        for (const t of repo.test_specifications) sections += `<tr><td>${t.name}</td><td>${t.type || '-'}</td><td>${t.description || '-'}</td><td>${t.expected_result || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Validation Criteria
                    if (repo.validation_criteria?.length) {
                        sections += `<h3>Validation Criteria (${repo.validation_criteria.length})</h3><table><tr><th>Name</th><th>Priority</th><th>Condition</th><th>Description</th></tr>`
                        for (const v of repo.validation_criteria) sections += `<tr><td>${v.name}</td><td>${v.priority || '-'}</td><td>${v.acceptance_condition || '-'}</td><td>${v.description || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Remediation Plan
                    if (repo.remediation_plan?.length) {
                        sections += `<h3>Remediation Plan (${repo.remediation_plan.length})</h3><table><tr><th>Item</th><th>Priority</th><th>Effort</th><th>Description</th></tr>`
                        for (const r of repo.remediation_plan) sections += `<tr><td>${r.item}</td><td>${r.priority || '-'}</td><td>${r.effort || '-'}</td><td>${r.description || '-'}</td></tr>`
                        sections += `</table>`
                    }

                    // Diagrams (Mermaid)
                    if (repo.diagrams?.length) {
                        sections += `<h3>Diagrams (${repo.diagrams.length})</h3>`
                        for (const d of repo.diagrams) sections += `<pre class="mermaid">${d}</pre>`
                    }

                    // Transformation-specific fields
                    if (repo.transformation_summary) {
                        const ts = repo.transformation_summary
                        sections += `<h3>Transformation Summary</h3><ul>`
                        if (ts.transformation_name) sections += `<li><b>Name:</b> ${ts.transformation_name}</li>`
                        if (ts.status) sections += `<li><b>Status:</b> ${ts.status}</li>`
                        if (ts.files_modified_count) sections += `<li><b>Files Modified:</b> ${ts.files_modified_count}</li>`
                        if (ts.languages_affected?.length) sections += `<li><b>Languages:</b> ${ts.languages_affected.join(', ')}</li>`
                        sections += `</ul>`
                    }
                    if (repo.changes_made?.length) {
                        sections += `<h3>Changes Made (${repo.changes_made.length})</h3><table><tr><th>File</th><th>Type</th><th>Category</th><th>Description</th></tr>`
                        for (const c of repo.changes_made) sections += `<tr><td>${c.file_path || '-'}</td><td>${c.change_type || '-'}</td><td>${c.category || '-'}</td><td>${c.description || '-'}</td></tr>`
                        sections += `</table>`
                    }
                    if (repo.version_upgrades?.length) {
                        sections += `<h3>Version Upgrades (${repo.version_upgrades.length})</h3><table><tr><th>Component</th><th>From</th><th>To</th><th>Category</th></tr>`
                        for (const v of repo.version_upgrades) sections += `<tr><td>${v.component}</td><td>${v.from_version || '-'}</td><td>${v.to_version || '-'}</td><td>${v.category || '-'}</td></tr>`
                        sections += `</table>`
                    }
                    if (repo.validation_results) {
                        const vr = repo.validation_results
                        sections += `<h3>Validation Results</h3><ul>`
                        if (vr.build_status) sections += `<li><b>Build:</b> ${vr.build_status}</li>`
                        if (vr.test_status) sections += `<li><b>Tests:</b> ${vr.test_status} (${vr.tests_passed || 0}/${vr.test_count || 0} passed)</li>`
                        if (vr.errors?.length) sections += `<li><b>Errors:</b> ${vr.errors.join(', ')}</li>`
                        if (vr.warnings?.length) sections += `<li><b>Warnings:</b> ${vr.warnings.join(', ')}</li>`
                        sections += `</ul>`
                    }
                    if (repo.remaining_work?.length) {
                        sections += `<h3>Remaining Work (${repo.remaining_work.length})</h3><table><tr><th>Item</th><th>Severity</th><th>Description</th><th>Effort</th></tr>`
                        for (const r of repo.remaining_work) sections += `<tr><td>${r.item}</td><td>${r.severity || '-'}</td><td>${r.description || '-'}</td><td>${r.estimated_effort || '-'}</td></tr>`
                        sections += `</table>`
                    }
                    if (repo.dependency_changes?.length) {
                        sections += `<h3>Dependency Changes (${repo.dependency_changes.length})</h3><table><tr><th>Name</th><th>From</th><th>To</th><th>Action</th><th>Reason</th></tr>`
                        for (const d of repo.dependency_changes) sections += `<tr><td>${d.name}</td><td>${d.from_version || '-'}</td><td>${d.to_version || '-'}</td><td>${d.action || '-'}</td><td>${d.reason || '-'}</td></tr>`
                        sections += `</table>`
                    }
                    if (repo.migration_impact) {
                        const mi = repo.migration_impact
                        sections += `<h3>Migration Impact</h3><ul>`
                        if (mi.risk_level) sections += `<li><b>Risk Level:</b> ${mi.risk_level}</li>`
                        if (mi.rollback_complexity) sections += `<li><b>Rollback Complexity:</b> ${mi.rollback_complexity}</li>`
                        if (mi.backward_compatible !== undefined) sections += `<li><b>Backward Compatible:</b> ${mi.backward_compatible ? 'Yes' : 'No'}</li>`
                        if (mi.testing_requirements) sections += `<li><b>Testing Requirements:</b> ${mi.testing_requirements}</li>`
                        if (mi.deployment_notes) sections += `<li><b>Deployment Notes:</b> ${mi.deployment_notes}</li>`
                        sections += `</ul>`
                    }
                }
                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} — ${appId}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:1100px;margin:0 auto;padding:20px;color:#1a1a1a}
h1{color:#0972d3;border-bottom:2px solid #0972d3;padding-bottom:8px}h2{color:#232f3e;margin-top:30px;border-bottom:1px solid #e9ebed;padding-bottom:6px}
h3{color:#414d5c;margin-top:20px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{border:1px solid #e9ebed;padding:8px;text-align:left;font-size:13px}
th{background:#f2f3f3;font-weight:600}.summary{background:#f0f8ff;padding:12px;border-radius:6px;margin:10px 0}
ul{line-height:1.8}b{color:#232f3e}pre.mermaid{background:#f8f9fa;padding:16px;border-radius:6px;overflow-x:auto;border:1px solid #e9ebed;text-align:center}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"><\/script>
<script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose'});<\/script>
</head><body>
<h1>${title}</h1><p>Application: <b>${appId}</b> | Generated: ${new Date().toLocaleString()}</p>${sections}</body></html>`
                const blob = new Blob([html], { type: 'text/html' })
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = `${filename}.html`; a.click()
                window.URL.revokeObjectURL(url)
            }
        } catch (e: any) { flash('error', `Download failed: ${e.message}`) }
    }

    const retryAnalysis = async () => {
        if (!selectedApp) return
        try {
            const resp = await apiClient.get(`/ara/atx/tasks?app_id=${selectedApp.application_id}`)
            const tasks = (resp.data.tasks || []).filter((t: any) => t.status === 'failed')
            if (!tasks.length) { flash('warning', 'No failed task found'); return }
            const task = tasks[0]
            if (task.task_type === 'atx_combined' && task.combined_conversation_id) {
                await apiClient.post(`/ara/atx/retry-combined/${task.task_id}`)
            } else {
                await apiClient.post(`/ara/atx/retry/${task.task_id}`)
            }
            setAnalysisStatuses(prev => ({ ...prev, [selectedApp.application_id]: { ...prev[selectedApp.application_id], status: 'in_progress' } }))
            flash('info', 'Retry submitted')
        } catch (e: any) { flash('error', `Retry failed: ${e.message}`) }
    }

    // ── Transform actions ───────────────────────────────────────────────────────
    const viewTransformAssessment = async (run: any) => {
        setLoadingTransformAssessment(true)
        setTransformAssessmentData([])
        setTransformAssessmentRun(run)
        setShowTransformAssessmentModal(true)
        try {
            const resp = await apiClient.get(`/ara/atx/transform/assessments/${run.application_id}?run_id=${run.run_id}`)
            if (resp.data.success && resp.data.assessments?.length > 0) {
                setTransformAssessmentData(resp.data.assessments)
            } else {
                flash('info', 'Extracting transformation assessment — this may take a moment...')
                const extractResp = await apiClient.post(`/ara/atx/transform/extract/${run.task_id}`)
                if (extractResp.data.success) {
                    const resp2 = await apiClient.get(`/ara/atx/transform/assessments/${run.application_id}?run_id=${run.run_id}`)
                    if (resp2.data.success) setTransformAssessmentData(resp2.data.assessments || [])
                    else flash('warning', 'Extraction completed but no assessment data returned')
                } else {
                    flash('error', 'Extraction failed — check the ARA backend logs')
                }
            }
        } catch (e: any) { flash('error', `Failed: ${e.message}`) }
        setLoadingTransformAssessment(false)
    }

    const openTransformModal = async (repoUrl: string) => {
        setSelectedRepoUrl(repoUrl); setBranchName(''); setPushToRepo(true)
        setSteps([{ transformation: null, contextText: '', selectedNotes: [] }]); setShowReview(false)
        setShowTransformModal(true)  // open immediately
        try {
            const resp = await apiClient.get('/ara/atx/transform/definitions')
            setTransformDefs(resp.data.transformations || [])
        } catch {
            setTransformDefs([
                { name: 'AWS/java-version-upgrade', description: 'Upgrade Java version to latest LTS' },
                { name: 'AWS/spring-boot-upgrade', description: 'Upgrade Spring Boot to latest version' },
                { name: 'AWS/comprehensive-codebase-analysis', description: 'Full codebase analysis' },
                { name: 'AWS/containerize-application', description: 'Containerize with Docker' },
                { name: 'AWS/modernize-dependencies', description: 'Modernize outdated dependencies' },
            ])
        }
    }

    const handleTransformSubmit = async () => {
        const valid = steps.filter(s => s.transformation)
        if (!valid.length) { flash('warning', 'Select at least one transformation'); return }
        // Validate context text is provided for each step
        for (let i = 0; i < valid.length; i++) {
            if (!valid[i].contextText.trim()) {
                flash('error', `Step ${i + 1} (${valid[i].transformation!.name}) requires context text. Provide target version, migration goals, or specific instructions.`)
                return
            }
        }
        setSubmitting(true)
        try {
            const formData = new FormData()
            formData.append('payload', JSON.stringify({
                application_id: selectedApp?.application_id, repo_url: selectedRepoUrl,
                branch: branchName.trim(), push_to_repo: pushToRepo,
                transformations: valid.map(s => ({ name: s.transformation!.name, context_text: s.contextText })),
            }))
            const resp = await apiClient.post('/ara/atx/transform', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
            if (resp.data.success) { flash('info', `Transformation queued for ${getRepoName(selectedRepoUrl)}`); loadTransformRuns() }
        } catch (e: any) { flash('error', `Failed: ${e.response?.data?.detail || e.message}`) }
        setShowTransformModal(false); setSubmitting(false)
    }

    const updateStep = (idx: number, field: keyof TransformStep, value: any) =>
        setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))

    // ── Table columns ─────────────────────────────────────────────────────────
    const columns: TableProps.ColumnDefinition<Application>[] = [
        { id: 'app_id', header: 'App ID', cell: i => i.application_id, width: 90 },
        { id: 'app_name', header: 'Application', cell: i => i.application_name || '-' },
        { id: 'wave', header: 'Wave', cell: i => i.WAVE ? <Badge>{i.WAVE}</Badge> : '-', width: 80 },
        {
            id: 'repos', header: 'Repos', cell: i => {
                const n = (i.scm_urls || []).length
                return n ? <Box variant="small">{n} repo{n > 1 ? 's' : ''}</Box> : <StatusIndicator type="warning">None</StatusIndicator>
            }, width: 80
        },
        {
            id: 'analysis', header: 'Analysis', cell: i => {
                if (statusLoading && !(i.application_id in analysisStatuses)) {
                    return <div style={{ height: 16, width: 80, borderRadius: 4, background: 'linear-gradient(90deg, #e8e8e8 25%, #f5f5f5 50%, #e8e8e8 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.2s infinite' }} />
                }
                const info = analysisStatuses[i.application_id]
                if (!info) return <Box color="text-body-secondary">-</Box>
                const s = info.status || ''; const total = info.total_repos || 0; const done = info.completed_repos || 0; const failed = info.failed_repos || 0
                const hasOrder = info.execution_order && info.execution_order.length > 0
                const orderTotal = hasOrder ? info.execution_order.length : total
                const orderDone = hasOrder ? (info.current_repo_index ?? done) : done
                if (s === 'in_progress' || s.startsWith('running_atx')) return <StatusIndicator type="in-progress">{orderTotal > 0 ? `${orderDone}/${orderTotal} repos` : 'Running'}</StatusIndicator>
                if (s === 'completed') return <StatusIndicator type="success">{orderTotal > 0 ? `${done}/${orderTotal} repos` : 'Done'}</StatusIndicator>
                if (s === 'failed') return <StatusIndicator type="error">{orderTotal > 0 ? `${failed}/${orderTotal} Failed` : 'Failed'}</StatusIndicator>
                return <Box color="text-body-secondary">-</Box>
            }, width: 130
        },
        {
            id: 'transform', header: 'Transform', cell: i => {
                const appRuns = transformRuns.filter(r => r.application_id === i.application_id)
                if (!appRuns.length) return <Box color="text-body-secondary">-</Box>
                const running = appRuns.filter(r => r.status === 'processing').length
                const completed = appRuns.filter(r => r.status === 'completed').length
                const failed = appRuns.filter(r => r.status === 'failed').length
                if (running > 0) return <StatusIndicator type="in-progress">{running} running</StatusIndicator>
                if (failed > 0) return <StatusIndicator type="error">{failed} failed</StatusIndicator>
                if (completed > 0) return <StatusIndicator type="success">Done</StatusIndicator>
                return <Box color="text-body-secondary">-</Box>
            }, width: 130
        },
    ]

    const waves = [...new Set(applications.map(a => a.WAVE).filter(Boolean))].sort() as string[]

    const filtered = applications.filter(a => {
        if (filterText && !a.application_name?.toLowerCase().includes(filterText.toLowerCase()) && !a.application_id?.includes(filterText)) return false
        if (filterWave && a.WAVE !== filterWave) return false
        return true
    })
    const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    const analysisInfo = selectedApp ? analysisStatuses[selectedApp.application_id] : null
    const analysisStatus = analysisInfo?.status || ''
    const analysisRunning = analysisStatus === 'in_progress' || analysisStatus.startsWith('running_atx')
    const analysisDone = analysisStatus === 'completed' || (analysisInfo?.completed_repos > 0)
    const analysisFailed = analysisStatus === 'failed'
    const appTransformRuns = selectedApp ? transformRuns.filter(r => r.application_id === selectedApp.application_id) : []

    // ── Helpers for ordered progress display ─────────────────────────────────
    const hasCombinedData = !!(analysisInfo?.execution_order && analysisInfo.execution_order.length > 0)
    const executionOrder: string[] = analysisInfo?.execution_order || []
    const currentRepo = analysisInfo?.current_repo || ''
    const currentRepoIndex = analysisDone
        ? (analysisInfo?.completed_repos || executionOrder.length)
        : (analysisInfo?.current_repo_index != null ? analysisInfo.current_repo_index + 1 : (analysisInfo?.completed_repos || 0))

    const getRepoStatusIcon = (repoName: string) => {
        const rs = analysisInfo?.repo_statuses?.[repoName]
        const status = typeof rs === 'object' ? rs?.status : rs
        if (status === 'completed') return <span style={{ color: '#1d8102' }}>✓</span>
        if (status === 'failed') return <span style={{ color: '#d91515' }}>✗</span>
        if (status === 'analyzing' || repoName === currentRepo) return <span style={{ color: '#0972d3' }}>⊙</span>
        return <span style={{ color: '#8d9096' }}>○</span>
    }

    const getRepoStatusColor = (repoName: string) => {
        const rs = analysisInfo?.repo_statuses?.[repoName]
        const status = typeof rs === 'object' ? rs?.status : rs
        if (status === 'completed') return '#1d8102'
        if (status === 'failed') return '#d91515'
        if (status === 'analyzing' || repoName === currentRepo) return '#0972d3'
        return '#8d9096'
    }

    // ── Drawer tab content ────────────────────────────────────────────────────
    const analysisTabContent = (
        <SpaceBetween size="m">
            {/* Task 6: Mermaid dependency graph — hidden for now, uncomment to re-enable
            {analysisInfo?.mermaid_diagram && (
                <Box>
                    <Box variant="awsui-key-label" padding={{ bottom: 'xs' }}>Dependency Graph</Box>
                    <div style={{ maxWidth: 480, overflow: 'auto', border: '1px solid var(--color-border-divider-default, #e9ebed)', borderRadius: 4, padding: 4 }}>
                        <MermaidDiagram chart={analysisInfo.mermaid_diagram} />
                    </div>
                </Box>
            )}
            */}

            {/* Task 7: Ordered progress list when execution_order is present */}
            {hasCombinedData && analysisRunning ? (
                <Box>
                    <Box variant="awsui-key-label">
                        {analysisRunning
                            ? `Analyzing ${currentRepoIndex}/${executionOrder.length} ${executionOrder.length === 1 ? 'Repository' : 'Repositories'}`
                            : `${executionOrder.length === 1 ? 'Repository' : 'Repositories'}`}
                    </Box>
                    {analysisRunning && currentRepo && (
                        <Box variant="small" color="text-status-info" padding={{ top: 'xxs', bottom: 'xs' }}>
                            Analyzing repo {currentRepoIndex + 1}/{executionOrder.length}: {currentRepo}
                        </Box>
                    )}
                    <div style={{ margin: '4px 0' }}>
                        {executionOrder.map(repoName => {
                            const isActive = repoName === currentRepo && analysisRunning
                            return (
                                <div key={repoName} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    padding: '3px 6px', borderRadius: 4, fontSize: 13,
                                    backgroundColor: isActive ? 'rgba(9, 114, 211, 0.06)' : undefined,
                                    fontWeight: isActive ? 600 : 400,
                                    color: getRepoStatusColor(repoName),
                                }}>
                                    <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{getRepoStatusIcon(repoName)}</span>
                                    <span title={(selectedApp?.scm_urls || []).find(u => getRepoName(u) === repoName) || repoName}>{repoName}</span>
                                    {isActive && <span style={{ fontSize: 11, color: '#0972d3' }}>← analyzing</span>}
                                </div>
                            )
                        })}
                    </div>
                </Box>
            ) : (
                <Box><Box variant="awsui-key-label">Repos</Box>
                    {(selectedApp?.scm_urls || []).length === 0
                        ? <StatusIndicator type="warning">None configured</StatusIndicator>
                        : <div style={{ margin: '4px 0' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', marginBottom: 4 }}>
                                <input type="checkbox"
                                    checked={selectedRepos.length === (selectedApp?.scm_urls || []).length}
                                    onChange={e => setSelectedRepos(e.target.checked ? (selectedApp?.scm_urls || []) : [])} />
                                <span style={{ fontWeight: 600 }}>Select All</span>
                            </label>
                            {(selectedApp?.scm_urls || []).map(url => {
                                const name = getRepoName(url)
                                const rs = analysisInfo?.repo_statuses?.[name]
                                const repoStatus = typeof rs === 'object' ? rs?.status : rs
                                const done = repoStatus === 'completed'
                                const failed = repoStatus === 'failed'
                                return (
                                    <label key={url} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: done ? '#1d8102' : failed ? '#d91515' : undefined }}>
                                        <input type="checkbox" checked={selectedRepos.includes(url)}
                                            onChange={e => setSelectedRepos(prev => e.target.checked ? [...prev, url] : prev.filter(u => u !== url))} />
                                        <span title={url}>{name}</span>
                                        <a href={url.split('#')[0]} target="_blank" rel="noopener noreferrer" title="Open in GitHub" style={{ display: 'inline-flex', color: '#5f6b7a', flexShrink: 0 }}>
                                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                                        </a>
                                    </label>
                                )
                            })}
                        </div>}
                </Box>
            )}

            <Box><Box variant="awsui-key-label">Status</Box>
                {analysisRunning
                    ? <StatusIndicator type="in-progress">
                        {analysisStatus.startsWith('running_atx') ? analysisStatus : `Running (${analysisInfo?.completed_repos || 0}/${analysisInfo?.total_repos || 0} repos done)`}
                    </StatusIndicator>
                    : analysisDone ? <StatusIndicator type="success">Completed ({analysisInfo?.completed_repos || 0}/{analysisInfo?.total_repos || 0} repos)</StatusIndicator>
                        : analysisFailed ? <StatusIndicator type="error">Failed ({analysisInfo?.failed_repos || 0}/{analysisInfo?.total_repos || 0} repos)</StatusIndicator>
                            : <Box color="text-body-secondary">Not started</Box>}
            </Box>
            {/* Notes context selection */}
            {availableNotes.length > 0 && (
                <Box>
                    <Box variant="awsui-key-label">Context Notes (optional)</Box>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                        {availableNotes.map(note => (
                            <label key={note.file_key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                <input type="checkbox" checked={selectedNoteKeys.includes(note.file_key)}
                                    onChange={e => setSelectedNoteKeys(prev => e.target.checked ? [...prev, note.file_key] : prev.filter(k => k !== note.file_key))} />
                                {note._label}
                            </label>
                        ))}
                    </div>
                </Box>
            )}
            {/* Branch input */}
            <Box>
                <Box variant="awsui-key-label">Branch (required)</Box>
                <Input value={analysisBranch} onChange={({ detail }) => setAnalysisBranch(detail.value)}
                    placeholder="e.g. main, develop" disabled={analysisRunning} />
            </Box>
            <SpaceBetween direction="horizontal" size="xs">
                <Tooltip text="Analyzes each repository separately. Best when repos are independent." align="left">
                    <Button variant="primary" loading={submitting} disabled={analysisRunning || !analysisBranch.trim() || selectedRepos.length === 0} onClick={() => submitAnalysis(false)}>Run Analysis</Button>
                </Tooltip>
                <Tooltip text="Analyzes all repositories together as one application. Best when repos are related (e.g. frontend, backend, infrastructure) — gives a complete picture of how they work together." align="right">
                    <Button loading={submitting} disabled={analysisRunning || !analysisBranch.trim() || selectedRepos.length === 0} onClick={() => submitAnalysis(true)}>Run Aggegration</Button>
                </Tooltip>
                {analysisFailed && <Button iconName="redo" onClick={retryAnalysis}>Retry</Button>}
            </SpaceBetween>

            {/* Recent Runs */}
            {analysisRuns.length > 0 && (
                <Box>
                    <Box variant="awsui-key-label">Recent Runs</Box>
                    <div style={{ borderTop: '1px solid var(--color-border-divider-default, #e9ebed)', marginTop: 6 }}>
                        {analysisRuns.slice(0, 5).map(run => {
                            const repoStatuses = run.repo_statuses || {}
                            const repoNames = Object.keys(repoStatuses)
                            const completed = repoNames.filter(n => { const r = repoStatuses[n]; return (typeof r === 'object' ? r?.status : r) === 'completed' }).length
                            const failed = repoNames.filter(n => { const r = repoStatuses[n]; return (typeof r === 'object' ? r?.status : r) === 'failed' }).length
                            const total = repoNames.length
                            const runStatus = run.status === 'completed' || (completed > 0 && failed + completed >= total) ? 'completed' : run.status === 'failed' ? 'failed' : 'in-progress'
                            return (
                                <div key={run.task_id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                                    <Box variant="small" color="text-body-secondary">{run.created_at ? new Date(run.created_at).toLocaleString() : ''}</Box>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                        <StatusIndicator type={runStatus === 'completed' ? 'success' : runStatus === 'failed' ? 'error' : 'in-progress'}>
                                            {completed}/{total} repos
                                        </StatusIndicator>
                                        {run.branch && <Badge>{run.branch}</Badge>}
                                    </div>
                                    <div style={{ paddingLeft: 4, marginTop: 2, fontSize: 12, color: '#5f6b7a' }}>
                                        {repoNames.map(name => {
                                            const rs = repoStatuses[name]
                                            const s = typeof rs === 'object' ? rs?.status : rs
                                            const icon = s === 'completed' ? '✓' : s === 'failed' ? '✗' : '○'
                                            const color = s === 'completed' ? '#1d8102' : s === 'failed' ? '#d91515' : '#8d9096'
                                            return <span key={name} style={{ marginRight: 10, color }}>{icon} {name}</span>
                                        })}
                                    </div>
                                    {runStatus === 'completed' && (
                                        <div style={{ paddingTop: 6 }}>
                                            <Button loading={extractingTaskId === run.task_id} onClick={() => viewAnalysis(run)}>View Analysis</Button>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </Box>
            )}
        </SpaceBetween>
    )

    const transformTabContent = (
        <SpaceBetween size="m">
            {!analysisDone && !transformWarningDismissed && (
                <Alert type="warning" dismissible onDismiss={() => setTransformWarningDismissed(true)}
                    action={<Button onClick={() => { setActiveTab('analysis') }}>Go to Analysis</Button>}>
                    <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
                        <li>Code analysis has not completed. Running analysis first is recommended — it identifies what needs to be transformed and helps choose the right transformation and context.</li>
                        <li>You can still proceed, but the transformation may be incomplete or target the wrong areas without analysis insights.</li>
                    </ul>
                </Alert>
            )}
            <SpaceBetween size="l">
                {/* Repositories section */}
                <Box>
                    <Box variant="awsui-key-label">Repositories</Box>
                    <div style={{ borderTop: '1px solid var(--color-border-divider-default, #e9ebed)', marginTop: 6 }}>
                        {(selectedApp?.scm_urls || []).length === 0
                            ? <Box color="text-body-secondary" padding={{ top: 's' }}>No repositories configured.</Box>
                            : (selectedApp?.scm_urls || []).map(url => (
                                <div key={url} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--color-border-divider-default, #e9ebed)' }}>
                                    <span style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }} title={url}>
                                        {getRepoName(url)}
                                        <a href={url.split('#')[0]} target="_blank" rel="noopener noreferrer" title="Open in GitHub" style={{ display: 'inline-flex', color: '#5f6b7a', flexShrink: 0 }}>
                                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                                        </a>
                                    </span>
                                    <Button variant="link" onClick={() => openTransformModal(url)}>Transform ›</Button>
                                </div>
                            ))
                        }
                    </div>
                </Box>

                {/* Recent runs section */}
                <Box>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box variant="awsui-key-label">Recent Runs</Box>
                    </div>
                    <div style={{ borderTop: '1px solid var(--color-border-divider-default, #e9ebed)', marginTop: 6 }}>
                        {!appTransformRuns.length
                            ? <Box color="text-body-secondary" padding={{ top: 's' }}>No transformation runs yet.</Box>
                            : (() => {
                                // Group runs by repo
                                const byRepo: Record<string, any[]> = {}
                                appTransformRuns.forEach(run => {
                                    const repo = run.repo_name || getRepoName(run.repo_url || '') || 'unknown'
                                    if (!byRepo[repo]) byRepo[repo] = []
                                    byRepo[repo].push(run)
                                })
                                return Object.entries(byRepo).map(([repo, runs]) => (
                                    <div key={repo} style={{ paddingTop: 10, paddingBottom: 6 }}>
                                        <Box variant="small" color="text-label">{repo}</Box>
                                        <SpaceBetween size="xs">
                                            {runs.map(run => (
                                                <div key={run.task_id} style={{ paddingLeft: 8, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
                                                    <Box variant="small" color="text-body-secondary" padding={{ bottom: 'xxs' }}>{run.created_at ? new Date(run.created_at).toLocaleString() : ''}</Box>
                                                    {(run.transformations || []).map((t: any, i: number) => (
                                                        <div key={i} style={{ padding: '3px 0' }}>
                                                            <StatusIndicator type={t.status === 'completed' ? 'success' : t.status === 'failed' ? 'error' : 'in-progress'}>
                                                                {t.name?.replace('AWS/', '')}
                                                            </StatusIndicator>
                                                            <div style={{ paddingLeft: 20, marginTop: 4, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px' }}>
                                                                {run.branch && <><Box variant="small" color="text-body-secondary">Branch</Box><Box variant="small">{run.branch}</Box></>}
                                                                <Box variant="small" color="text-body-secondary">Push</Box><Box variant="small">{run.push_to_repo ? `Yes → origin/${run.branch || 'branch'}` : 'No (local only)'}</Box>
                                                                {t.updated_at && <><Box variant="small" color="text-body-secondary">Updated</Box><Box variant="small">{new Date(t.updated_at).toLocaleString()}</Box></>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {run.status === 'completed' && (
                                                        <div style={{ paddingTop: 6 }}>
                                                            <Button onClick={() => viewTransformAssessment(run)}>View Transformation</Button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </SpaceBetween>
                                    </div>
                                ))
                            })()
                        }
                    </div>
                </Box>
            </SpaceBetween>
        </SpaceBetween>
    )

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <ContentLayout header={<Header variant="h1" description="Select an application to analyze or transform its repositories">ATX Workbench</Header>}>
            <SpaceBetween size="l">
                <style>{`@keyframes shimmer { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }`}</style>
                {flashItems.length > 0 && <Flashbar items={flashItems} />}

                {/* App table — shifts left when drawer is open */}
                <div style={{ marginRight: selectedApp ? 540 : 0, transition: 'margin-right 0.25s ease' }}>
                    <Table
                        header={<Header variant="h2" counter={`(${filtered.length})`} description="Click a row to open the workbench drawer" actions={
                            <Button iconName="refresh" onClick={() => { loadApplications(); loadTransformRuns() }} />
                        }>Applications</Header>}
                        columnDefinitions={columns}
                        items={paginated}
                        loading={loading}
                        loadingText="Loading..."
                        selectionType="single"
                        selectedItems={selectedApp ? [selectedApp] : []}
                        onSelectionChange={({ detail }) => {
                            setSelectedApp(detail.selectedItems[0] || null)
                            setActiveTab('analysis')
                        }}
                        trackBy="application_id"
                        wrapLines={false}
                        filter={
                            <SpaceBetween direction="horizontal" size="s">
                                <TextFilter filteringText={filterText} onChange={({ detail }) => { setFilterText(detail.filteringText); setCurrentPage(1) }} filteringPlaceholder="Filter by name or ID" />
                                <Select selectedOption={filterWave ? { label: filterWave, value: filterWave } : null}
                                    onChange={({ detail }) => { setFilterWave(detail.selectedOption?.value || ''); setCurrentPage(1) }}
                                    options={[{ label: 'All Waves', value: '' }, ...waves.map(w => ({ label: w, value: w }))]}
                                    placeholder="Wave" />
                            </SpaceBetween>
                        }
                        pagination={<Pagination currentPageIndex={currentPage} pagesCount={Math.ceil(filtered.length / PAGE_SIZE) || 1} onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)} />}
                        empty={<Box textAlign="center"><b>No applications</b></Box>}
                    />
                </div>

                {/* Slide-in drawer */}
                {selectedApp && (
                    <AppDrawer app={selectedApp} onClose={() => setSelectedApp(null)}>
                        <Tabs activeTabId={activeTab} onChange={({ detail }) => setActiveTab(detail.activeTabId)} tabs={[
                            { id: 'analysis', label: 'Code Analysis', content: analysisTabContent },
                            { id: 'transformation', label: 'Transformation', content: transformTabContent },
                        ]} />
                    </AppDrawer>
                )}

                {/* Code Analysis results modal */}
                <Modal visible={showCodeAnalysisModal} onDismiss={() => setShowCodeAnalysisModal(false)}
                    header={
                        <SpaceBetween direction="horizontal" size="m">
                            <span>{`Code Analysis — ${selectedApp?.application_id} (${selectedApp?.application_name})${viewingAnalysisRun?.branch ? ` · Branch: ${viewingAnalysisRun.branch}` : ''}`}</span>
                            <Button iconName="download" variant="link" onClick={() => {
                                if (selectedApp) downloadAssessment(selectedApp.application_id, 'analysis', 'html')
                            }}>Download HTML</Button>
                            <Button iconName="download" variant="link" onClick={() => {
                                if (selectedApp) downloadAssessment(selectedApp.application_id, 'analysis', 'json')
                            }}>Download JSON</Button>
                        </SpaceBetween>
                    } size="max">
                    <CodeAnalysisTab applicationId={selectedApp?.application_id || null} analysisInfo={analysisInfo} runId={viewingAnalysisRun?.run_id} />
                </Modal>

                {/* Transform config modal */}
                <Modal visible={showTransformModal} onDismiss={() => setShowTransformModal(false)} size="large"
                    header={`ATX Transformation — ${selectedApp?.application_name} / ${getRepoName(selectedRepoUrl)}`}
                    footer={!showReview
                        ? <Box float="right"><SpaceBetween direction="horizontal" size="xs">
                            <Button onClick={() => setShowTransformModal(false)}>Cancel</Button>
                            <Button onClick={() => setSteps(prev => [...prev, { transformation: null, contextText: '', selectedNotes: [] }])}>+ Add Step</Button>
                            <Button variant="primary" disabled={!steps.some(s => s.transformation && s.contextText.trim()) || !branchName.trim()} onClick={() => setShowReview(true)}>Review</Button>
                        </SpaceBetween></Box>
                        : <Box float="right"><SpaceBetween direction="horizontal" size="xs">
                            <Button onClick={() => setShowReview(false)}>Back</Button>
                            <Button variant="primary" loading={submitting} onClick={handleTransformSubmit}>Run Transformations</Button>
                        </SpaceBetween></Box>
                    }>
                    <SpaceBetween size="m">
                        <Container>
                            <ColumnLayout columns={2}>
                                <FormField label="Branch (required)">
                                    <Input value={branchName} onChange={({ detail }) => setBranchName(detail.value)} placeholder="e.g. atx-java-upgrade" />
                                </FormField>
                                <div style={{ paddingTop: 24 }}>
                                    <Checkbox checked={pushToRepo} onChange={({ detail }) => setPushToRepo(detail.checked)}>Push changes after completion</Checkbox>
                                </div>
                            </ColumnLayout>
                        </Container>
                        {!showReview ? steps.map((step, idx) => (
                            <Container key={idx} header={<Header variant="h3" actions={steps.length > 1 ? <Button variant="link" onClick={() => setSteps(prev => prev.filter((_, i) => i !== idx))}>Remove</Button> : undefined}>Step {idx + 1}</Header>}>
                                <SpaceBetween size="m">
                                    <FormField label="Transformation">
                                        <Select
                                            selectedOption={step.transformation ? { label: step.transformation.name, value: step.transformation.name } : null}
                                            onChange={({ detail }) => updateStep(idx, 'transformation', transformDefs.find(t => t.name === detail.selectedOption.value) || null)}
                                            options={transformDefs.map(t => ({ label: t.name, value: t.name, description: t.description }))}
                                            placeholder="Select transformation" filteringType="auto"
                                        />
                                    </FormField>
                                    {step.transformation && <Alert type="info">{step.transformation.description}</Alert>}
                                    <FormField label="Context (required)" description="Target version, migration goals, or specific instructions">
                                        <Textarea value={step.contextText} rows={3} placeholder="e.g., Upgrade to Java 21. Use Jakarta EE 10. Keep Spring Boot 3.x compatibility."
                                            onChange={({ detail }) => updateStep(idx, 'contextText', detail.value)} />
                                    </FormField>
                                    {availableNotes.length > 0 && (
                                        <FormField label="Context Notes (optional)">
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                {availableNotes.map(note => (
                                                    <label key={note.file_key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                                        <input type="checkbox" checked={(step.selectedNotes || []).includes(note.file_key)}
                                                            onChange={e => {
                                                                const notes = e.target.checked
                                                                    ? [...(step.selectedNotes || []), note.file_key]
                                                                    : (step.selectedNotes || []).filter((k: string) => k !== note.file_key)
                                                                updateStep(idx, 'selectedNotes', notes)
                                                            }} />
                                                        {note._label}
                                                    </label>
                                                ))}
                                            </div>
                                        </FormField>
                                    )}
                                </SpaceBetween>
                            </Container>
                        )) : (
                            <Container header={<Header variant="h3">Pipeline Summary</Header>}>
                                <SpaceBetween size="m">
                                    {steps.filter(s => s.transformation).map((s, i) => (
                                        <div key={i} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--color-border-divider-default, #e9ebed)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                                <Badge color="blue">Step {i + 1}</Badge>
                                                <span style={{ fontWeight: 600, fontSize: 14 }}>{s.transformation!.name}</span>
                                            </div>
                                            {s.contextText && (
                                                <div style={{ marginBottom: 6 }}>
                                                    <Box variant="awsui-key-label">Context</Box>
                                                    <Box variant="small">{s.contextText}</Box>
                                                </div>
                                            )}
                                            {(s.selectedNotes || []).length > 0 && (
                                                <div>
                                                    <Box variant="awsui-key-label">Notes</Box>
                                                    {(s.selectedNotes || []).map(k => {
                                                        const note = availableNotes.find(n => n.file_key === k)
                                                        return <Box key={k} variant="small">{note?._label || k.split('/').pop()}</Box>
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </SpaceBetween>
                            </Container>
                        )}
                    </SpaceBetween>
                </Modal>

                {/* Transform Assessment modal */}
                <Modal visible={showTransformAssessmentModal} onDismiss={() => setShowTransformAssessmentModal(false)} size="max"
                    header={
                        <SpaceBetween direction="horizontal" size="m">
                            <span>Transformation Assessment{transformAssessmentRun?.run_id ? ` — Run: ${transformAssessmentRun.run_id}` : ''}{transformAssessmentRun?.branch ? ` · Branch: ${transformAssessmentRun.branch}` : ''}</span>
                            {transformAssessmentRun && <>
                                <Button iconName="download" variant="link" onClick={() => downloadAssessment(transformAssessmentRun.application_id, 'transformation', 'html')}>Download HTML</Button>
                                <Button iconName="download" variant="link" onClick={() => downloadAssessment(transformAssessmentRun.application_id, 'transformation', 'json')}>Download JSON</Button>
                            </>}
                        </SpaceBetween>
                    }>
                    {loadingTransformAssessment ? <StatusIndicator type="loading">Loading assessment...</StatusIndicator>
                        : transformAssessmentData.length === 0 ? <Box textAlign="center" padding="l">No assessment data available.</Box>
                            : <SpaceBetween size="m">
                                {transformAssessmentData.map((a: any, i: number) => (
                                    <Container key={i} header={<Header variant="h3">{a.transformation_name || `Step ${a.step_index}`}</Header>}>
                                        <SpaceBetween size="m">
                                            {a.executive_summary && <Alert type="info">{typeof a.executive_summary === 'string' ? a.executive_summary : JSON.stringify(a.executive_summary)}</Alert>}
                                            {a.transformation_summary && (
                                                <ColumnLayout columns={4}>
                                                    <Box><Box variant="awsui-key-label">Status</Box>{a.transformation_summary?.status || '-'}</Box>
                                                    <Box><Box variant="awsui-key-label">Files Modified</Box>{a.transformation_summary?.files_modified_count || '-'}</Box>
                                                    <Box><Box variant="awsui-key-label">Lines Changed</Box>{a.transformation_summary?.lines_changed || '-'}</Box>
                                                    <Box><Box variant="awsui-key-label">Transformation</Box>{a.transformation_summary?.transformation_name || '-'}</Box>
                                                </ColumnLayout>
                                            )}
                                            {Array.isArray(a.version_upgrades) && a.version_upgrades.length > 0 && (
                                                <Box>
                                                    <Box variant="awsui-key-label">Version Upgrades ({a.version_upgrades.length})</Box>
                                                    <Table columnDefinitions={[
                                                        { id: 'component', header: 'Component', cell: (v: any) => v.component, width: 200 },
                                                        { id: 'from', header: 'From', cell: (v: any) => <Badge color="grey">{v.from_version}</Badge>, width: 120 },
                                                        { id: 'to', header: 'To', cell: (v: any) => <Badge color="green">{v.to_version}</Badge>, width: 120 },
                                                        { id: 'category', header: 'Category', cell: (v: any) => v.category || '-', width: 120 },
                                                    ]} items={a.version_upgrades} variant="embedded" />
                                                </Box>
                                            )}
                                            {Array.isArray(a.breaking_changes) && a.breaking_changes.length > 0 && (
                                                <Box>
                                                    <Box variant="awsui-key-label">Breaking Changes ({a.breaking_changes.length})</Box>
                                                    <Table columnDefinitions={[
                                                        { id: 'change', header: 'Change', cell: (b: any) => b.change, width: 250 },
                                                        { id: 'impact', header: 'Impact', cell: (b: any) => b.impact, width: 200 },
                                                        { id: 'manual', header: 'Manual Action', cell: (b: any) => b.manual_action_required ? <Badge color="red">Required</Badge> : <Badge color="green">No</Badge>, width: 100 },
                                                    ]} items={a.breaking_changes} variant="embedded" />
                                                </Box>
                                            )}
                                            {Array.isArray(a.remaining_work) && a.remaining_work.length > 0 && (
                                                <Box>
                                                    <Box variant="awsui-key-label">Remaining Work ({a.remaining_work.length})</Box>
                                                    <Table columnDefinitions={[
                                                        { id: 'item', header: 'Item', cell: (r: any) => r.item },
                                                        { id: 'severity', header: 'Severity', cell: (r: any) => <Badge color={r.severity === 'critical' || r.severity === 'high' ? 'red' : 'blue'}>{r.severity}</Badge>, width: 100 },
                                                        { id: 'desc', header: 'Description', cell: (r: any) => r.description },
                                                    ]} items={a.remaining_work} variant="embedded" />
                                                </Box>
                                            )}
                                        </SpaceBetween>
                                    </Container>
                                ))}
                            </SpaceBetween>
                    }
                </Modal>
            </SpaceBetween>
        </ContentLayout>
    )
}
