import { useState, useEffect, useCallback } from 'react'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
  Table,
  Box,
  Badge,
  Button,
  Select,
  FormField,
  ColumnLayout,
  Modal,
  ProgressBar,
  Tabs,
  Pagination,
  SelectProps,
  TableProps,
  Input,
} from '@cloudscape-design/components'
import apiClient from '../../../uno/services/api'

import ReadinessInputWizard, { ReadinessInputs } from './ReadinessInputWizard'
import RiskSummaryTab from './RiskSummaryTab'
import RiskScoreTab from './RiskScoreTab'
import ComplexityTab from './ComplexityTab'
import MigrationReadinessTab from './MigrationReadinessTab'
import TeamReadinessTab from './TeamReadinessTab'
import BusinessReadinessTab from './BusinessReadinessTab'

interface Application {
  application_id: string
  application_name: string
  WAVE: string
  wave?: string
}

interface Assessment {
  assessment_id: string
  app_id: string
  overall_score: number
  risk_level: string
  assessment_date: number
  s3_report_key: string
  wave_id?: string
}

interface WaveSummary {
  total_applications: number
  wave_distribution: Record<string, number>
  applications: Application[]
}

interface PaginatedResponse {
  success: boolean
  applications: Application[]
  total_count: number
  page: number
  page_size: number
  total_pages: number
}

export default function RiskAssessmentList() {

  // Application and assessment data
  const [applications, setApplications] = useState<Application[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [loadingApps, setLoadingApps] = useState(true)
  const [loadingAssessments, setLoadingAssessments] = useState(true)

  // Pagination
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE = 10

  // Filters
  const [selectedWave, setSelectedWave] = useState<SelectProps.Option | null>(null)
  const [selectedAppName, setSelectedAppName] = useState('')
  const [waves, setWaves] = useState<string[]>([])

  // Selection for running assessments
  const [selectedItems, setSelectedItems] = useState<Application[]>([])
  const [isAssessing, setIsAssessing] = useState(false)
  const [assessmentProgress, setAssessmentProgress] = useState(0)
  const [showWizard, setShowWizard] = useState(false)
  const [currentAssessmentApp, setCurrentAssessmentApp] = useState<Application | null>(null)

  // Detail modal
  const [selectedAppForDetail, setSelectedAppForDetail] = useState<string | null>(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [detailAssessment, setDetailAssessment] = useState<any>(null)
  const [activeTabId, setActiveTabId] = useState('summary')

  const loadApplications = useCallback(async (page: number = 1) => {
    try {
      setLoadingApps(true)
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
      })
      if (selectedWave?.value) params.set('wave', selectedWave.value)
      if (selectedAppName) params.set('name', selectedAppName)

      const response = await apiClient.get<PaginatedResponse>(`/wave/applications/paginated?${params}`)

      if (response.data.success) {
        // Backend already filtered out unassigned apps
        setApplications(response.data.applications)
        setTotalCount(response.data.total_count)
        setTotalPages(response.data.total_pages)
        setCurrentPage(response.data.page)
      }
    } catch (error) {
      console.error('Error loading applications:', error)
    } finally {
      setLoadingApps(false)
    }
  }, [selectedWave, selectedAppName])

  const loadWaves = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; data: WaveSummary }>('/wave/applications/slim')
      if (response.data.success) {
        const allApps = response.data.data.applications
        const uniqueWaves = [...new Set(allApps.map(app => app.WAVE || app.wave || ''))].filter(
          w => w && w.trim() !== '' && w !== 'unassigned'
        )
        setWaves(uniqueWaves.sort())
      }
    } catch (error) {
      console.error('Error loading waves:', error)
    }
  }

  useEffect(() => {
    loadWaves()
    loadAssessments()
  }, [])

  // Reload page 1 when filters change
  useEffect(() => {
    setSelectedItems([])
    loadApplications(1)
  }, [loadApplications])

  const loadAssessments = async () => {
    try {
      setLoadingAssessments(true)
      const response = await apiClient.get<{ success: boolean; assessments: Assessment[] }>('/ara/risk/assessments')

      if (response.data.success) {
        setAssessments(response.data.assessments)
      }
    } catch (error) {
      console.error('Error loading assessments:', error)
    } finally {
      setLoadingAssessments(false)
    }
  }

  const handleRunAssessment = () => {
    if (selectedItems.length === 0) return

    if (selectedItems.length === 1) {
      setCurrentAssessmentApp(selectedItems[0])
      setShowWizard(true)
      return
    }

    startBatchAssessment(null)
  }

  const handleWizardSubmit = (inputs: ReadinessInputs) => {
    setShowWizard(false)
    startSingleAssessment(currentAssessmentApp!, inputs)
  }

  const handleWizardDismiss = () => {
    setShowWizard(false)
    setCurrentAssessmentApp(null)
  }

  const startSingleAssessment = async (app: Application, inputs: ReadinessInputs | null) => {
    setIsAssessing(true)
    setAssessmentProgress(0)

    try {
      const payload: any = {
        application_id: app.application_id
      }

      if (inputs) {
        // Map numeric values back to string labels for backend validation
        const teamAvailabilityMap: Record<number, string> = { 100: 'Dedicated', 50: 'Part-time', 0: 'None' }
        const skillLevelMap: Record<number, string> = { 100: 'Expert', 50: 'Some experience', 0: 'No experience' }
        const knowledgeTransferMap: Record<number, string> = { 100: 'Full docs + devs', 75: 'Key person', 50: 'Docs only', 0: 'None' }
        const trainingCompletedMap: Record<number, string> = { 100: 'All trained', 50: 'Some trained', 0: 'No training' }

        const maintenanceWindowMap: Record<number, string> = { 100: 'Flexible', 50: 'Limited', 0: 'No downtime' }
        const businessCalendarMap: Record<number, string> = { 100: 'Off-peak', 50: 'Normal', 0: 'Peak season' }
        const stakeholderAlignmentMap: Record<number, string> = { 100: 'Full buy-in', 50: 'Some concerns', 0: 'Strong resistance' }
        const budgetAvailabilityMap: Record<number, string> = { 100: 'Fully funded', 50: 'Partial', 0: 'No budget' }

        payload.team_readiness_inputs = {
          team_availability: teamAvailabilityMap[inputs.team.teamAvailability] || 'None',
          skill_level: skillLevelMap[inputs.team.skillLevel] || 'No experience',
          knowledge_transfer: knowledgeTransferMap[inputs.team.knowledgeTransfer] || 'None',
          training_completed: trainingCompletedMap[inputs.team.trainingCompleted] || 'No training'
        }
        payload.business_readiness_inputs = {
          maintenance_window: maintenanceWindowMap[inputs.business.maintenanceWindow] || 'No downtime',
          business_calendar: businessCalendarMap[inputs.business.businessCalendar] || 'Peak season',
          stakeholder_alignment: stakeholderAlignmentMap[inputs.business.stakeholderAlignment] || 'Strong resistance',
          budget_availability: budgetAvailabilityMap[inputs.business.budgetAvailability] || 'No budget'
        }
      }

      const progressInterval = setInterval(() => {
        setAssessmentProgress((prev: number) => Math.min(prev + 10, 90))
      }, 500)

      await apiClient.post('/ara/risk/assess', payload)

      clearInterval(progressInterval)
      setAssessmentProgress(100)

      setTimeout(() => {
        setIsAssessing(false)
        setAssessmentProgress(0)
        setSelectedItems([])
        loadAssessments()
      }, 1000)

    } catch (error) {
      console.error('Error running assessment:', error)
      setIsAssessing(false)
    }
  }

  const startBatchAssessment = async (_inputs: ReadinessInputs | null) => {
    setIsAssessing(true)
    setAssessmentProgress(0)

    try {
      const appIds = selectedItems.map(app => app.application_id)

      // Use the parallel endpoint for batch assessments
      const progressInterval = setInterval(() => {
        setAssessmentProgress((prev: number) => Math.min(prev + 5, 90))
      }, 1000)

      await apiClient.post('/ara/risk/assess/parallel', {
        application_ids: appIds
      })

      clearInterval(progressInterval)
      setAssessmentProgress(100)

      setTimeout(() => {
        setIsAssessing(false)
        setAssessmentProgress(0)
        setSelectedItems([])
        loadAssessments()
      }, 1000)

    } catch (error) {
      console.error('Error running batch assessment:', error)
      setIsAssessing(false)
    }
  }

  const handleViewDetails = async (appId: string) => {
    const appAssessments = assessments.filter((a: Assessment) => a.app_id === appId)

    if (appAssessments.length > 0) {
      const latestAssessment = appAssessments.sort((a: Assessment, b: Assessment) => b.assessment_date - a.assessment_date)[0]

      try {
        const response = await apiClient.get(`/ara/risk/report/${latestAssessment.assessment_id}`)
        const fullReport = response.data
        setDetailAssessment(fullReport)
        setSelectedAppForDetail(appId)
        setShowDetailModal(true)
      } catch (error) {
        console.error('Error loading full report:', error)
        alert('Failed to load assessment details. Please try again.')
      }
    }
  }

  const getRiskLevelBadge = (riskLevel: string) => {
    const colorMap: Record<string, 'red' | 'blue' | 'green' | 'grey'> = {
      critical: 'red',
      high: 'red',
      medium: 'blue',
      low: 'green',
    }
    return <Badge color={colorMap[riskLevel] || 'grey'}>{riskLevel?.toUpperCase() || 'N/A'}</Badge>
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString()
  }

  const getLatestAssessment = (appId: string): Assessment | undefined => {
    const appAssessments = assessments.filter((a: Assessment) => a.app_id === appId)
    if (appAssessments.length === 0) return undefined
    return appAssessments.sort((a: Assessment, b: Assessment) => b.assessment_date - a.assessment_date)[0]
  }

  const columns: TableProps.ColumnDefinition<Application>[] = [
    {
      id: 'application_id',
      header: 'Application ID',
      cell: (item: Application) => item.application_id,
      sortingField: 'application_id',
      width: 150,
      minWidth: 120,
    },
    {
      id: 'application_name',
      header: 'Application Name',
      cell: (item: Application) => item.application_name,
      sortingField: 'application_name',
      width: 200,
      minWidth: 150,
    },
    {
      id: 'wave',
      header: 'Wave',
      cell: (item: Application) => <Badge color="blue">{item.WAVE || item.wave || 'N/A'}</Badge>,
      sortingField: 'WAVE',
      width: 120,
      minWidth: 100,
    },
    {
      id: 'overall_score',
      header: 'Overall Score',
      cell: (item: Application) => {
        const assessment = getLatestAssessment(item.application_id)
        return assessment ? (
          <Box fontSize="heading-m" fontWeight="bold" color="text-status-info">
            {assessment.overall_score}/100
          </Box>
        ) : (
          <Box color="text-body-secondary">-</Box>
        )
      },
      width: 130,
      minWidth: 110,
    },
    {
      id: 'risk_level',
      header: 'Risk Level',
      cell: (item: Application) => {
        const assessment = getLatestAssessment(item.application_id)
        return assessment ? getRiskLevelBadge(assessment.risk_level) : <Box color="text-body-secondary">No assessment</Box>
      },
      width: 120,
      minWidth: 100,
    },
    {
      id: 'assessment_date',
      header: 'Assessment Date',
      cell: (item: Application) => {
        const assessment = getLatestAssessment(item.application_id)
        return assessment ? formatDate(assessment.assessment_date) : <Box color="text-body-secondary">Never</Box>
      },
      width: 140,
      minWidth: 120,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (item: Application) => {
        const assessment = getLatestAssessment(item.application_id)
        return assessment ? (
          <Button
            variant="inline-link"
            onClick={() => handleViewDetails(item.application_id)}
          >
            View
          </Button>
        ) : (
          <Box color="text-body-secondary">No data</Box>
        )
      },
      width: 120,
      minWidth: 100,
    },
  ]

  const detailTabs = [
    {
      id: 'summary',
      label: 'Overall Summary',
      content: <RiskSummaryTab reportData={detailAssessment} />,
    },
    {
      id: 'risk-score',
      label: 'Risk Score',
      content: <RiskScoreTab reportData={detailAssessment} />,
    },
    {
      id: 'complexity',
      label: 'Complexity',
      content: <ComplexityTab reportData={detailAssessment} />,
    },
    {
      id: 'migration-readiness',
      label: 'Migration Readiness',
      content: <MigrationReadinessTab reportData={detailAssessment} />,
    },
    {
      id: 'team-readiness',
      label: 'Team Readiness',
      content: <TeamReadinessTab reportData={detailAssessment} />,
    },
    {
      id: 'business-readiness',
      label: 'Business Readiness',
      content: <BusinessReadinessTab reportData={detailAssessment} />,
    },
  ]

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="View and manage assessments for applications">
          Assessment
        </Header>
      }
    >
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

        {/* Applications List */}
        <Container
          header={
            <Header
              variant="h2"
              counter={`(${totalCount})`}
              actions={
                <>
                  <Button
                    variant="primary"
                    onClick={handleRunAssessment}
                    disabled={selectedItems.length === 0 || isAssessing}
                    loading={isAssessing}
                  >
                    Run Assessment ({selectedItems.length})
                  </Button>
                  {' '}
                  <Button iconName="refresh" onClick={() => { loadApplications(currentPage); loadAssessments(); }}>
                    Refresh
                  </Button>
                </>
              }
            >
              Applications
            </Header>
          }
        >
          <SpaceBetween size="m">
            {isAssessing && (
              <ProgressBar
                value={assessmentProgress}
                label={`Running assessment${selectedItems.length > 1 ? 's' : ''}...`}
                status={assessmentProgress === 100 ? 'success' : 'in-progress'}
              />
            )}

            <Table
              columnDefinitions={columns}
              items={applications}
              loading={loadingApps || loadingAssessments}
              loadingText="Loading applications..."
              sortingDisabled={false}
              selectionType="multi"
              trackBy="application_id"
              selectedItems={selectedItems}
              onSelectionChange={(event: any) => {
                // Clamp selection to only items on the current page
                const currentIds = new Set(applications.map(a => a.application_id))
                const validItems = event.detail.selectedItems.filter(
                  (item: Application) => currentIds.has(item.application_id)
                )
                setSelectedItems(validItems)
              }}
              variant="container"
              stickyHeader={true}
              stripedRows={true}
              wrapLines={false}
              resizableColumns={true}
              pagination={
                <Pagination
                  currentPageIndex={currentPage}
                  pagesCount={totalPages}
                  ariaLabels={{
                    nextPageLabel: "Next page",
                    previousPageLabel: "Previous page",
                    pageLabel: pageNumber => `Page ${pageNumber} of ${totalPages}`
                  }}
                  onChange={({ detail }) => {
                    setSelectedItems([])
                    loadApplications(detail.currentPageIndex)
                  }}
                />
              }
              empty={
                <Box textAlign="center" color="inherit">
                  <Box variant="p" color="inherit">
                    <strong>No applications found</strong>
                  </Box>
                  <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                    No applications match the current filters.
                  </Box>
                </Box>
              }
            />
          </SpaceBetween>
        </Container>
      </SpaceBetween>

      {/* Wizards and Modals */}
      <ReadinessInputWizard
        visible={showWizard}
        onDismiss={handleWizardDismiss}
        onSubmit={handleWizardSubmit}
      />

      <Modal
        visible={showDetailModal}
        onDismiss={() => {
          setShowDetailModal(false)
          setSelectedAppForDetail(null)
          setDetailAssessment(null)
          setActiveTabId('summary')
        }}
        header={`Assessment Details - ${selectedAppForDetail}`}
        size="max"
      >
        <Tabs
          activeTabId={activeTabId}
          onChange={(event: any) => setActiveTabId(event.detail.activeTabId)}
          tabs={detailTabs}
        />
      </Modal>
    </ContentLayout>
  )
}
