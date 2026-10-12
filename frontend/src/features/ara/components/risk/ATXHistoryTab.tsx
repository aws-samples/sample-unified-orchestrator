import { useState, useEffect } from 'react'
import {
  Container, Header, SpaceBetween, Box, Badge, Button, Tabs,
  StatusIndicator, TextFilter, Select, SelectProps, ExpandableSection,
} from '@cloudscape-design/components'
import apiClient from '../../../uno/services/api'

interface App { application_id: string; application_name: string; WAVE?: string; scm_urls?: string[] }
interface Task {
  task_id: string; application_id: string; task_type: string; status: string
  run_id: string; branch?: string; created_at: string; repo_statuses?: Record<string, any>
  selected_repos?: string[]; transformations?: any[]
}

const getRepoName = (url: string) => url.split('#')[0].split('/').pop()?.replace('.git', '') || url

const getStatusBadge = (status: string) => {
  if (status === 'completed') return <StatusIndicator type="success">Completed</StatusIndicator>
  if (status === 'failed') return <StatusIndicator type="error">Failed</StatusIndicator>
  if (status === 'processing' || status === 'in_progress') return <StatusIndicator type="in-progress">Running</StatusIndicator>
  return <StatusIndicator type="pending">{status}</StatusIndicator>
}

export default function ATXHistoryTab() {
  const [activeTab, setActiveTab] = useState('analysis')
  const [applications, setApplications] = useState<App[]>([])
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [filterStatus, setFilterStatus] = useState<SelectProps.Option | null>(null)
  const [filterWave, setFilterWave] = useState<string>('')

  // Lazy-loaded tasks per app: { appId: { analysis: Task[], transform: Task[], loaded: boolean } }
  const [appTasks, setAppTasks] = useState<Record<string, { analysis: Task[]; transform: Task[]; loading: boolean }>>({})
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set())
  const [showAllRuns, setShowAllRuns] = useState<Set<string>>(new Set())

  useEffect(() => { loadApps() }, [])

  const loadApps = async () => {
    setLoading(true)
    try {
      const resp = await apiClient.get('/wave/applications?summary=false')
      if (resp.data.success) {
        const apps = (resp.data.data.applications || []).filter((a: App) => (a.scm_urls || []).length > 0)
        setApplications(apps)
      }
    } catch {}
    setLoading(false)
  }

  const loadTasksForApp = async (appId: string) => {
    if (appTasks[appId]?.loading) return
    setAppTasks(prev => ({ ...prev, [appId]: { analysis: prev[appId]?.analysis || [], transform: prev[appId]?.transform || [], loading: true } }))
    try {
      const [analysisResp, transformResp] = await Promise.all([
        apiClient.get(`/ara/atx/tasks?app_id=${appId}`).catch(() => ({ data: { tasks: [] } })),
        apiClient.get(`/ara/atx/transform/tasks?app_id=${appId}`).catch(() => ({ data: { tasks: [] } })),
      ])
      const analysis = (analysisResp.data.tasks || []).filter((t: Task) => t.task_type !== 'atx_transform')
      const transform = transformResp.data.tasks || []
      setAppTasks(prev => ({ ...prev, [appId]: { analysis, transform, loading: false } }))
    } catch {
      setAppTasks(prev => ({ ...prev, [appId]: { analysis: [], transform: [], loading: false } }))
    }
  }

  const handleExpand = (appId: string, expanded: boolean) => {
    const next = new Set(expandedApps)
    if (expanded) {
      next.add(appId)
      if (!appTasks[appId] || (!appTasks[appId].analysis.length && !appTasks[appId].transform.length && !appTasks[appId].loading)) {
        loadTasksForApp(appId)
      }
    } else {
      next.delete(appId)
    }
    setExpandedApps(next)
  }

  const downloadRun = async (appId: string, runId: string) => {
    try {
      const resp = await apiClient.get(`/ara/atx/download/${appId}/${runId}?zip=true`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url; a.download = `${appId}_${runId}.zip`; a.click()
      window.URL.revokeObjectURL(url)
    } catch (e: any) {
      if (e.response?.status === 404) alert('No files available for this run.')
    }
  }

  const waves = [...new Set(applications.map(a => a.WAVE).filter(Boolean))].sort() as string[]

  const filteredApps = applications.filter(a => {
    if (filterText) {
      const s = filterText.toLowerCase()
      if (!a.application_id.includes(s) && !a.application_name?.toLowerCase().includes(s)) return false
    }
    if (filterWave && a.WAVE !== filterWave) return false
    return true
  })

  const renderRunRow = (task: Task, type: 'analysis' | 'transform') => {
    const repoNames = Object.keys(task.repo_statuses || {})
    const transformations = task.transformations || []
    const stats = type === 'analysis'
      ? { total: repoNames.length || (task.selected_repos || []).length, completed: repoNames.filter(n => { const r = task.repo_statuses?.[n]; return (typeof r === 'object' ? r?.status : r) === 'completed' }).length }
      : { total: transformations.length, completed: transformations.filter((t: any) => t.status === 'completed').length }
    const taskStatus = task.status === 'processing' && stats.completed + (type === 'analysis' ? repoNames.filter(n => { const r = task.repo_statuses?.[n]; return (typeof r === 'object' ? r?.status : r) === 'failed' }).length : 0) >= stats.total ? 'failed' : task.status
    const label = type === 'analysis' ? `${stats.completed}/${stats.total} repos` : `${stats.completed}/${stats.total} steps`

    return (
      <div key={task.task_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
        <div style={{ flex: 1 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {getStatusBadge(taskStatus)}
            <span style={{ color: '#5f6b7a' }}>{label}</span>
            {task.branch && <Badge>{task.branch}</Badge>}
            <span style={{ color: '#8d9096', fontSize: 11 }}>{new Date(task.created_at).toLocaleString()}</span>
          </span>
          <div style={{ paddingLeft: 4, marginTop: 2, fontSize: 12, color: '#5f6b7a' }}>
            {type === 'analysis' ? repoNames.map(name => {
              const rs = task.repo_statuses?.[name]
              const s = typeof rs === 'object' ? rs?.status : rs
              const icon = s === 'completed' ? '✓' : s === 'failed' ? '✗' : '○'
              const color = s === 'completed' ? '#1d8102' : s === 'failed' ? '#d91515' : '#8d9096'
              return <span key={name} style={{ marginRight: 10, color }} title={(task.selected_repos || []).find(u => getRepoName(u) === name) || name}>{icon} {name}</span>
            }) : transformations.map((t: any, i: number) => {
              const icon = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : '○'
              const color = t.status === 'completed' ? '#1d8102' : t.status === 'failed' ? '#d91515' : '#8d9096'
              return <span key={i} style={{ marginRight: 10, color }}>{icon} {t.name?.replace('AWS/', '') || '-'}</span>
            })}
          </div>
        </div>
        {task.run_id && <Button iconName="download" variant="icon" ariaLabel="Download" onClick={() => downloadRun(task.application_id, task.run_id)} />}
      </div>
    )
  }

  const renderTab = (type: 'analysis' | 'transform') => (
    <SpaceBetween size="m">
      <SpaceBetween direction="horizontal" size="s">
        <TextFilter filteringText={filterText} onChange={({ detail }) => setFilterText(detail.filteringText)}
          filteringPlaceholder="Filter by app name or ID" />
        <Select selectedOption={filterWave ? { label: filterWave, value: filterWave } : null}
          onChange={({ detail }) => setFilterWave(detail.selectedOption?.value || '')}
          options={[{ label: 'All Waves', value: '' }, ...waves.map(w => ({ label: w, value: w }))]}
          placeholder="Wave" />
      </SpaceBetween>

      {loading ? <Box textAlign="center" padding="l"><StatusIndicator type="loading">Loading applications...</StatusIndicator></Box>
        : filteredApps.length === 0 ? <Box textAlign="center" padding="l" color="text-body-secondary">No applications with repositories found.</Box>
        : (
        <SpaceBetween size="s">
          {filteredApps.map(app => {
            const data = appTasks[app.application_id]
            const tasks = type === 'analysis' ? (data?.analysis || []) : (data?.transform || [])
            const isExpanded = expandedApps.has(app.application_id)
            const showAll = showAllRuns.has(`${type}-${app.application_id}`)
            const visibleTasks = filterStatus?.value ? tasks.filter(t => t.status === filterStatus.value) : tasks
            const displayTasks = showAll ? visibleTasks : visibleTasks.slice(0, 3)

            return (
              <ExpandableSection key={app.application_id}
                expanded={isExpanded}
                onChange={({ detail }) => handleExpand(app.application_id, detail.expanded)}
                headerText={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{app.application_name}</span>
                    <Badge color="blue">{app.application_id}</Badge>
                    {app.WAVE && <Badge>{app.WAVE}</Badge>}
                    <span style={{ color: '#5f6b7a', fontSize: 12 }}>{(app.scm_urls || []).length} repo{(app.scm_urls || []).length !== 1 ? 's' : ''}</span>
                  </span>
                }
                variant="container">
                {data?.loading ? <Box textAlign="center" padding="s"><StatusIndicator type="loading">Loading runs...</StatusIndicator></Box>
                  : visibleTasks.length === 0 ? <Box color="text-body-secondary" padding="s">No {type === 'analysis' ? 'code analysis' : 'transformation'} runs.</Box>
                  : (
                  <SpaceBetween size="xs">
                    {displayTasks.map(task => renderRunRow(task, type))}
                    {visibleTasks.length > 3 && !showAll && (
                      <Button variant="link" onClick={() => setShowAllRuns(prev => new Set([...prev, `${type}-${app.application_id}`]))}>
                        Show {visibleTasks.length - 3} more
                      </Button>
                    )}
                    {visibleTasks.length > 3 && showAll && (
                      <Button variant="link" onClick={() => setShowAllRuns(prev => { const n = new Set(prev); n.delete(`${type}-${app.application_id}`); return n })}>
                        Show less
                      </Button>
                    )}
                  </SpaceBetween>
                )}
              </ExpandableSection>
            )
          })}
        </SpaceBetween>
      )}
    </SpaceBetween>
  )

  return (
    <Container header={
      <Header variant="h2" actions={<Button iconName="refresh" onClick={loadApps} loading={loading}>Refresh</Button>}>
        ATX Workbench History
      </Header>
    }>
      <Tabs
        activeTabId={activeTab}
        onChange={({ detail }) => { setActiveTab(detail.activeTabId); setFilterText(''); setFilterStatus(null) }}
        tabs={[
          { id: 'analysis', label: 'Code Analysis', content: renderTab('analysis') },
          { id: 'transformation', label: 'Transformation', content: renderTab('transform') },
        ]}
      />
    </Container>
  )
}
