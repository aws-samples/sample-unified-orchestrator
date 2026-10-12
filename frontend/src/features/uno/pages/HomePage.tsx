import { useState, useEffect } from 'react'
import {
  ContentLayout, Header, SpaceBetween, Container, Table, Box, Spinner, Badge, ColumnLayout,
  Button, Pagination, TextFilter, Select, SelectProps,
} from '@cloudscape-design/components'
import apiClient from '../services/api'

interface Application {
  application_id: string
  application_name: string
  WAVE: string
  scm_urls?: string[]
}

export default function HomePage() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [filterWave, setFilterWave] = useState<SelectProps.Option | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 20

  useEffect(() => { loadApplications() }, [])

  const loadApplications = async () => {
    setLoading(true)
    try {
      const resp = await apiClient.get('/wave/applications?summary=false')
      if (resp.data.success) setApplications(resp.data.data.applications || [])
    } catch (e) { console.error('Failed to load applications:', e) }
    setLoading(false)
  }

  // Wave summary
  const waveCounts: Record<string, { apps: number; repos: number }> = {}
  applications.forEach(app => {
    const wave = app.WAVE || 'Unassigned'
    if (!waveCounts[wave]) waveCounts[wave] = { apps: 0, repos: 0 }
    waveCounts[wave].apps++
    waveCounts[wave].repos += (app.scm_urls || []).length
  })
  const waveEntries = Object.entries(waveCounts).sort(([a], [b]) => {
    if (a === 'Unassigned') return 1
    if (b === 'Unassigned') return -1
    return a.localeCompare(b)
  })

  const totalRepos = applications.reduce((sum, a) => sum + (a.scm_urls || []).length, 0)

  // Filtered apps
  const filtered = applications.filter(a => {
    if (filterText && !a.application_name?.toLowerCase().includes(filterText.toLowerCase()) && !a.application_id?.includes(filterText)) return false
    if (filterWave?.value && (a.WAVE || '') !== filterWave.value) return false
    return true
  })
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  return (
    <ContentLayout header={<Header variant="h1" description="Application portfolio overview">Dashboard</Header>}>
      <SpaceBetween size="l">
        {/* Summary cards */}
        <Container header={<Header variant="h2">Portfolio Summary</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Total Applications</Box>
              <Box fontSize="heading-xl" fontWeight="bold" color="text-status-info">{applications.length}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Total SCM Repositories</Box>
              <Box fontSize="heading-xl" fontWeight="bold" color="text-status-info">{totalRepos}</Box>
            </div>
            <div>
              <Box variant="awsui-key-label">Waves</Box>
              <Box fontSize="heading-xl" fontWeight="bold" color="text-status-info">{waveEntries.filter(([w]) => w !== 'Unassigned').length}</Box>
            </div>
          </ColumnLayout>
        </Container>

        {/* Wave breakdown */}
        <Container header={<Header variant="h2">Applications per Wave</Header>}>
          {loading ? <Box textAlign="center" padding="l"><Spinner size="large" /></Box> : (
            <Table
              columnDefinitions={[
                { id: 'wave', header: 'Wave', cell: ([w]) => <Badge>{w}</Badge>, width: 150 },
                { id: 'apps', header: 'Applications', cell: ([, c]) => c.apps, width: 120 },
                { id: 'repos', header: 'SCM Repos', cell: ([, c]) => c.repos, width: 120 },
              ]}
              items={waveEntries}
              variant="embedded"
              empty={<Box textAlign="center">No wave data</Box>}
            />
          )}
        </Container>

        {/* Application list */}
        <Container header={<Header variant="h2" counter={`(${filtered.length})`}
          actions={<Button iconName="refresh" onClick={loadApplications} />}>Applications</Header>}>
          {loading ? <Box textAlign="center" padding="l"><Spinner size="large" /></Box> : (
            <Table
              columnDefinitions={[
                { id: 'id', header: 'App ID', cell: i => i.application_id, width: 100 },
                { id: 'name', header: 'Application Name', cell: i => i.application_name || '-' },
                { id: 'wave', header: 'Wave', cell: i => i.WAVE ? <Badge>{i.WAVE}</Badge> : <Box color="text-body-secondary">-</Box>, width: 100 },
                { id: 'repos', header: 'SCM Repos', cell: i => (i.scm_urls || []).length || <Box color="text-body-secondary">0</Box>, width: 100 },
              ]}
              items={paginated}
              filter={
                <SpaceBetween direction="horizontal" size="s">
                  <TextFilter filteringText={filterText} onChange={({ detail }) => { setFilterText(detail.filteringText); setCurrentPage(1) }} filteringPlaceholder="Filter by name or ID" />
                  <Select selectedOption={filterWave} onChange={({ detail }) => { setFilterWave(detail.selectedOption); setCurrentPage(1) }}
                    options={[{ label: 'All Waves', value: '' }, ...waveEntries.map(([w]) => ({ label: w, value: w }))]}
                    placeholder="Wave" />
                </SpaceBetween>
              }
              pagination={<Pagination currentPageIndex={currentPage} pagesCount={Math.ceil(filtered.length / PAGE_SIZE) || 1} onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)} />}
              empty={<Box textAlign="center">No applications</Box>}
            />
          )}
        </Container>
      </SpaceBetween>
    </ContentLayout>
  )
}
