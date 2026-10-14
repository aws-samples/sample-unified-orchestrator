import { useState, useEffect, useMemo } from 'react'
import { Container, Header, Table, Box, Badge, Button, TableProps, SpaceBetween, Select, FormField, ColumnLayout, SelectProps, ExpandableSection, Input } from '@cloudscape-design/components'
import apiClient from '../../../uno/services/api'

interface Assessment {
  assessment_id: string
  app_id: string
  overall_score: number
  risk_level: string
  assessment_date: number
  s3_report_key?: string
  wave_id?: string
  is_latest?: boolean
}

interface Application {
  application_id: string
  application_name: string
  WAVE: string
  wave?: string
}

interface WaveSummary {
  total_applications: number
  wave_distribution: Record<string, number>
  applications: Application[]
}

interface AssessmentHistoryTabProps {
  appId?: string
}

interface GroupedAssessments {
  [appId: string]: {
    appName: string
    wave: string
    assessments: Assessment[]
    latestAssessment: Assessment
  }
}

export default function AssessmentHistoryTab({ appId }: AssessmentHistoryTabProps) {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingApps, setLoadingApps] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [appsWithCodeAnalysis, setAppsWithCodeAnalysis] = useState<Set<string>>(new Set())

  // Filters
  const [selectedWave, setSelectedWave] = useState<SelectProps.Option | null>(null)
  const [selectedAppName, setSelectedAppName] = useState('')
  const [waves, setWaves] = useState<string[]>([])

  useEffect(() => {
    loadAssessments()
    loadApplications()
  }, [appId])

  // Check which apps have code analysis
  useEffect(() => {
    if (applications.length > 0) {
      const ids = applications.map(a => a.application_id)
      apiClient.post('/ara/atx/status', ids)
        .then(resp => {
          const completed = new Set<string>()
          for (const [aid, status] of Object.entries(resp.data.statuses || {})) {
            if (status === 'completed') completed.add(aid)
          }
          setAppsWithCodeAnalysis(completed)
        })
        .catch(() => {})
    }
  }, [applications])

  const loadAssessments = async () => {
    try {
      setLoading(true)
      const url = appId ? `/ara/risk/assessments?app_id=${appId}&sort=date_desc` : '/ara/risk/assessments?sort=date_desc'
      const response = await apiClient.get<{ success: boolean; assessments: Assessment[] }>(url)
      if (response.data.success) {
        setAssessments(response.data.assessments)
      }
    } catch (error) {
      console.error('Error loading assessments:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadApplications = async () => {
    try {
      setLoadingApps(true)
      const response = await apiClient.get<{ success: boolean; data: WaveSummary }>('/wave/applications/slim')

      if (response.data.success) {
        const appsWithWave = response.data.data.applications.filter(app => {
          const wave = app.WAVE || app.wave || ''
          return wave && wave.trim() !== '' && wave !== 'unassigned'
        })
        setApplications(appsWithWave)

        const uniqueWaves = [...new Set(appsWithWave.map(app => app.WAVE || app.wave || ''))].filter(w => w)
        setWaves(uniqueWaves.sort())
      }
    } catch (error) {
      console.error('Error loading applications:', error)
    } finally {
      setLoadingApps(false)
    }
  }

  const getApplicationName = (appId: string): string => {
    const app = applications.find(a => a.application_id === appId)
    return app?.application_name || appId
  }

  const getApplicationWave = (appId: string): string => {
    const app = applications.find(a => a.application_id === appId)
    return app?.WAVE || app?.wave || '-'
  }

  // Group assessments by application ID
  const groupedAssessments = useMemo((): GroupedAssessments => {
    const filtered = assessments.filter((assessment: Assessment) => {
      const app = applications.find(a => a.application_id === assessment.app_id)
      const waveMatch = !selectedWave || !selectedWave.value || (app && (app.WAVE || 'unassigned') === selectedWave.value)
      const searchLower = selectedAppName.toLowerCase()
      const nameMatch = !selectedAppName || (app && (app.application_name || '').toLowerCase().includes(searchLower)) || assessment.app_id.toLowerCase().includes(searchLower)
      return waveMatch && nameMatch
    })

    const groups: GroupedAssessments = {}

    filtered.forEach(assessment => {
      if (!groups[assessment.app_id]) {
        groups[assessment.app_id] = {
          appName: getApplicationName(assessment.app_id),
          wave: getApplicationWave(assessment.app_id),
          assessments: [],
          latestAssessment: assessment
        }
      }
      groups[assessment.app_id].assessments.push(assessment)
    })

    // Mark latest assessment in each group
    Object.values(groups).forEach(group => {
      if (group.assessments.length > 0) {
        group.assessments[0].is_latest = true
      }
    })

    return groups
  }, [assessments, applications, selectedWave, selectedAppName])

  const toggleGroup = (appId: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(appId)) {
      newExpanded.delete(appId)
    } else {
      newExpanded.add(appId)
    }
    setExpandedGroups(newExpanded)
  }

  const getRiskBadge = (level: string) => {
    const colors: Record<string, 'red' | 'blue' | 'green' | 'grey'> = {
      critical: 'red', high: 'red', medium: 'blue', low: 'green'
    }
    return <Badge color={colors[level] || 'grey'}>{level.toUpperCase()}</Badge>
  }

  const formatDate = (ts: number) => new Date(ts * 1000).toLocaleString()

  const viewDetails = async (assessmentId: string) => {
    try {
      // Fetch via axios so the JWT Authorization header is attached
      const response = await apiClient.get(`/ara/risk/report/${assessmentId}?format=html&save=true`, {
        responseType: 'blob',
      })
      const blob = new Blob([response.data], { type: 'text/html' })
      const blobUrl = URL.createObjectURL(blob)
      const win = window.open(blobUrl, '_blank')
      // Revoke the object URL after the window has loaded to free memory
      if (win) {
        win.addEventListener('load', () => URL.revokeObjectURL(blobUrl))
      }
    } catch (error) {
      console.error('Failed to load report:', error)
    }
  }

  const columns: TableProps.ColumnDefinition<Assessment>[] = [
    {
      id: 'date',
      header: 'Assessment Date',
      cell: (i) => (
        <SpaceBetween direction="horizontal" size="xs">
          <span>{formatDate(i.assessment_date)}</span>
          {i.is_latest && <Badge color="green">Latest</Badge>}
        </SpaceBetween>
      ),
      width: 250
    },
    {
      id: 'risk',
      header: 'Risk Level',
      cell: (i) => getRiskBadge(i.risk_level),
      width: 120
    },
    {
      id: 'score',
      header: 'Overall Score',
      cell: (i) => (
        <Box fontSize="heading-m" fontWeight="bold" color="text-status-info">
          {i.overall_score}/100
        </Box>
      ),
      width: 130
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (i) => (
        <Button
          variant="inline-link"
          onClick={() => viewDetails(i.assessment_id)}
        >
          View Details
        </Button>
      ),
      width: 120
    }
  ]

  const totalAssessments = Object.values(groupedAssessments).reduce((sum, group) => sum + group.assessments.length, 0)

  return (
    <SpaceBetween size="l">
      {/* Filters */}
      <Container header={<Header variant="h2">Filters</Header>}>
        <ColumnLayout columns={3}>
          <FormField label="Filter by Wave">
            <Select
              selectedOption={selectedWave}
              onChange={(event: any) => setSelectedWave(event.detail.selectedOption)}
              options={[
                { label: 'All Waves', value: '' },
                ...waves.map((wave: string) => ({ label: wave, value: wave }))
              ]}
              placeholder="Select wave"
            />
          </FormField>

          <FormField label="Filter by name or ID">
            <Input
              value={selectedAppName}
              onChange={({ detail }) => setSelectedAppName(detail.value)}
              placeholder="Filter by name or ID"
              type="search"
            />
          </FormField>

          <FormField label="Actions">
            <Button onClick={() => { setSelectedWave(null); setSelectedAppName(''); }}>
              Clear Filters
            </Button>
          </FormField>
        </ColumnLayout>
      </Container>

      {/* Assessment History Grouped by Application */}
      <Container
        header={
          <Header
            variant="h2"
            description="Assessments grouped by application - click to expand"
            actions={
              <Button
                iconName="refresh"
                onClick={() => { loadAssessments(); loadApplications(); }}
                loading={loading || loadingApps}
              >
                Refresh
              </Button>
            }
            counter={`(${Object.keys(groupedAssessments).length} applications, ${totalAssessments} assessments)`}
          >
            Assessment History
          </Header>
        }
      >
        {loading || loadingApps ? (
          <Box textAlign="center" padding={{ vertical: 'l' }}>
            Loading assessments...
          </Box>
        ) : Object.keys(groupedAssessments).length === 0 ? (
          <Box textAlign="center" padding={{ vertical: 'l' }}>
            <SpaceBetween size="m">
              <Box variant="p">
                <strong>No assessments found</strong>
              </Box>
              <Box variant="p" color="text-body-secondary">
                Run an assessment to see results here.
              </Box>
            </SpaceBetween>
          </Box>
        ) : (
          <SpaceBetween size="m">
            {Object.entries(groupedAssessments).map(([appId, group]) => (
              <ExpandableSection
                key={appId}
                headerText={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{group.appName}</span>
                    <Badge color="blue">{appId}</Badge>
                    {group.wave !== '-' && <Badge>{group.wave}</Badge>}
                    {appsWithCodeAnalysis.has(appId) && <Badge color="green">Code Analysis</Badge>}
                    <span style={{ color: '#5f6b7a' }}>
                      ({group.assessments.length} assessment{group.assessments.length !== 1 ? 's' : ''})
                    </span>
                  </span>
                }
                variant="container"
                expanded={expandedGroups.has(appId)}
                onChange={() => toggleGroup(appId)}
                headerDescription={`Latest: ${formatDate(group.latestAssessment.assessment_date)} | Score: ${group.latestAssessment.overall_score}/100 | Risk: ${group.latestAssessment.risk_level.toUpperCase()}`}
              >
                <Table
                  columnDefinitions={columns}
                  items={group.assessments}
                  variant="embedded"
                  stripedRows
                  wrapLines={false}
                />
              </ExpandableSection>
            ))}
          </SpaceBetween>
        )}
      </Container>
    </SpaceBetween>
  )
}
