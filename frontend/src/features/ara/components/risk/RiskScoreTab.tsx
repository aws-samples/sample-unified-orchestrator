import {
  Container,
  Header,
  SpaceBetween,
  Box,
  ProgressBar,
  Badge,
  StatusIndicator,
  Table,
  TextFilter,
  Pagination,
  ColumnLayout,
} from '@cloudscape-design/components'
import { useMemo, useState } from 'react'

interface RiskBreakdown {
  eoslDaysRemaining: number
  eoslScore: number
  complianceViolations: number
  complianceScore: number
  securityVulnerabilities: number
  securityScore: number
  operationalIncidents: number
  operationalScore: number
}

interface RiskScoreData {
  overallRiskScore: number
  breakdown: RiskBreakdown
}

interface RiskScoreTabProps {
  data?: RiskScoreData
  loading?: boolean
}

export default function RiskScoreTab({ data, loading = false, assessmentData, reportData }: RiskScoreTabProps & { assessmentData?: any; reportData?: any }) {
  // State for search and pagination
  const [searchText, setSearchText] = useState('')
  const [currentPageIndex, setCurrentPageIndex] = useState(1)
  const itemsPerPage = 20

  // Use reportData if available, otherwise fall back to assessmentData
  const report = reportData || assessmentData

  // If no assessment has been run, show placeholder
  if (!report && !data && !loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Box variant="h2" padding={{ bottom: 's' }}>
            No Assessment Data
          </Box>
          <Box variant="p" color="text-body-secondary">
            Select an application and click "Run Assessment" to view risk score details.
          </Box>
        </Box>
      </Container>
    )
  }

  // Extract data from report
  const riskAssessment = report?.risk_assessment || {}
  const riskScore = report?.scores?.risk_score || riskAssessment.risk_score || 0
  const riskLevel = report?.risk_level || 'unknown'

  // Extract all components from categories for EOSL filtering
  const categories = report?.categories || {}
  const allComponents: any[] = []
  Object.keys(categories).forEach((categoryKey) => {
    const categoryComponents = categories[categoryKey] || []
    allComponents.push(...categoryComponents)
  })

  // Filter EOSL components (status '4' means End of Life)
  // eosl_status can be string '4' or int 4 depending on data source
  const eoslComponentsDetailed = allComponents.filter((c) => String(c.eosl_status) === '4')

  // Search filtering for EOSL components
  const filteredEoslComponents = useMemo(() => {
    if (!searchText) return eoslComponentsDetailed

    const lowerSearch = searchText.toLowerCase()
    return eoslComponentsDetailed.filter((component) => {
      return (
        (component.publisher || '').toLowerCase().includes(lowerSearch) ||
        (component.product || '').toLowerCase().includes(lowerSearch) ||
        (component.category || '').toLowerCase().includes(lowerSearch) ||
        (component.subcategory || '').toLowerCase().includes(lowerSearch) ||
        (component.full_version || '').toLowerCase().includes(lowerSearch)
      )
    })
  }, [eoslComponentsDetailed, searchText])

  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <ProgressBar label="Loading risk score data..." />
        </Box>
      </Container>
    )
  }

  const getScoreColor = (score: number): 'success' | 'in-progress' | 'error' => {
    if (score <= 30) return 'success'
    if (score <= 60) return 'in-progress'
    return 'error'
  }

  const getRiskLabel = (score: number): string => {
    if (score <= 20) return 'Very Low'
    if (score <= 40) return 'Low'
    if (score <= 60) return 'Moderate'
    if (score <= 80) return 'High'
    return 'Critical'
  }

  const getEOSLStatusBadge = (status: string) => {
    const statusMap: Record<string, { color: 'green' | 'blue' | 'grey' | 'red'; label: string }> = {
      '0': { color: 'green', label: 'Active' },
      '1': { color: 'green', label: 'Active' },
      '2': { color: 'blue', label: 'Approaching EOL' },
      '3': { color: 'grey', label: 'Extended Support' },
      '4': { color: 'red', label: 'End of Life' },
      '5': { color: 'grey', label: 'Unknown' },
    }
    const badge = statusMap[status] || { color: 'grey', label: 'Unknown' }
    return <Badge color={badge.color}>{badge.label}</Badge>
  }

  return (
    <SpaceBetween size="l">
      {/* Overall Risk Score Section */}
      <Container
        header={
          <Header variant="h2" description="Overall urgency assessment for migration (35% weight)">
            Risk Score
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Overall Risk Score</Box>
            <Box fontSize="display-l" fontWeight="bold">
              {riskScore}/100
            </Box>
            <Box variant="small" color="text-status-info">
              {getRiskLabel(riskScore)} - {riskLevel}
            </Box>
          </Box>

          <ProgressBar
            value={riskScore}
            variant="standalone"
            status={getScoreColor(riskScore)}
            label="Risk Score"
            description={`${riskScore}% - ${getRiskLabel(riskScore)}`}
          />

          <Box variant="p" color="text-body-secondary">
            The Risk Score measures urgency—how critical it is to migrate this application soon.
            Higher scores indicate greater urgency.
          </Box>
        </SpaceBetween>
      </Container>

      {/* Risk Factors Breakdown */}
      <Container
        header={
          <Header variant="h2" description="Detailed breakdown of risk factors">
            Risk Factors
          </Header>
        }
      >
        <ColumnLayout columns={2} variant="text-grid">
          {/* EOSL Risk */}
          <Box>
            <Box variant="awsui-key-label">EOSL Risk (40% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {riskAssessment.eosl_risk || 0}/100
            </Box>
            <ProgressBar
              value={riskAssessment.eosl_risk || 0}
              variant="standalone"
              status={getScoreColor(riskAssessment.eosl_risk || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {riskAssessment.eosl_components || 0} components at end of life
            </Box>
          </Box>

          {/* Vulnerability Risk */}
          <Box>
            <Box variant="awsui-key-label">Security Vulnerabilities (25% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {riskAssessment.vulnerability_risk || 0}/100
            </Box>
            <ProgressBar
              value={riskAssessment.vulnerability_risk || 0}
              variant="standalone"
              status={getScoreColor(riskAssessment.vulnerability_risk || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Known CVEs and security issues
            </Box>
          </Box>

          {/* Business Criticality */}
          <Box>
            <Box variant="awsui-key-label">Business Criticality (20% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {riskAssessment.business_criticality || 0}/100
            </Box>
            <ProgressBar
              value={riskAssessment.business_criticality || 0}
              variant="standalone"
              status={getScoreColor(riskAssessment.business_criticality || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Impact on business operations
            </Box>
          </Box>

          {/* Current Stability */}
          <Box>
            <Box variant="awsui-key-label">Current Stability (15% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {riskAssessment.stability_risk || 0}/100
            </Box>
            <ProgressBar
              value={riskAssessment.stability_risk || 0}
              variant="standalone"
              status={getScoreColor(riskAssessment.stability_risk || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              Operational incidents and downtime
            </Box>
          </Box>
        </ColumnLayout>
      </Container>

      {/* EOSL Risk - Components that are End of Life */}
      {eoslComponentsDetailed.length > 0 && (
        <Container
          header={
            <Header
              variant="h2"
              description="Components that have reached end of service life"
              counter={`(${filteredEoslComponents.length})`}
            >
              EOSL Components
            </Header>
          }
        >
          <SpaceBetween size="m">
            <Box variant="p" color="text-body-secondary">
              These components are already end-of-life and require immediate attention. Running EOSL components increases security risks and compliance violations.
            </Box>

            {/* Search Filter */}
            <TextFilter
              filteringText={searchText}
              filteringPlaceholder="Search by publisher, product, category, or version"
              filteringAriaLabel="Filter EOSL components"
              onChange={({ detail }) => {
                setSearchText(detail.filteringText)
                setCurrentPageIndex(1)
              }}
            />

            {/* Simple Flat Table */}
            <Table
              columnDefinitions={[
                {
                  id: 'publisher',
                  header: 'Publisher',
                  cell: (item: any) => item.publisher || '-',
                  sortingField: 'publisher',
                },
                {
                  id: 'product',
                  header: 'Product',
                  cell: (item: any) => item.product || '-',
                  sortingField: 'product',
                },
                {
                  id: 'current_version',
                  header: 'Current Version',
                  cell: (item: any) => item.full_version || '-',
                  sortingField: 'full_version',
                },
                {
                  id: 'category',
                  header: 'Category',
                  cell: (item: any) => item.subcategory || item.category || '-',
                },
                {
                  id: 'eosl_date',
                  header: 'EOSL Date',
                  cell: (item: any) => item.eosl_date || '-',
                  sortingField: 'eosl_date',
                },
                {
                  id: 'target_version',
                  header: 'Target Version',
                  cell: (item: any) => {
                    if (item.target_version && typeof item.target_version === 'object') {
                      return item.target_version.version || 'Not Found'
                    }
                    return item.target_version || 'Not Found'
                  },
                },
                {
                  id: 'eosl_status',
                  header: 'Status',
                  cell: (item: any) => getEOSLStatusBadge(item.eosl_status),
                },
              ]}
              items={filteredEoslComponents.slice(
                (currentPageIndex - 1) * itemsPerPage,
                currentPageIndex * itemsPerPage
              )}
              loadingText="Loading EOSL components"
              sortingDisabled
              stripedRows
              wrapLines
              empty={
                <Box textAlign="center" color="inherit">
                  <SpaceBetween size="xs">
                    <Box variant="strong">No EOSL components found</Box>
                    <Box variant="p" color="text-body-secondary">
                      Try adjusting your search filter
                    </Box>
                  </SpaceBetween>
                </Box>
              }
            />

            {/* Pagination */}
            {filteredEoslComponents.length > itemsPerPage && (
              <Pagination
                currentPageIndex={currentPageIndex}
                pagesCount={Math.ceil(filteredEoslComponents.length / itemsPerPage)}
                onChange={({ detail }) => setCurrentPageIndex(detail.currentPageIndex)}
                ariaLabels={{
                  nextPageLabel: 'Next page',
                  previousPageLabel: 'Previous page',
                  pageLabel: (pageNumber) => `Page ${pageNumber}`,
                }}
              />
            )}
          </SpaceBetween>
        </Container>
      )}

      {eoslComponentsDetailed.length === 0 && (
        <Container
          header={
            <Header variant="h2" description="No components at end of service life">
              EOSL Risk
            </Header>
          }
        >
          <Box textAlign="center" padding="l">
            <StatusIndicator type="success">No EOSL Components</StatusIndicator>
            <Box padding={{ top: 's' }} variant="p" color="text-body-secondary">
              All components are within their supported lifecycle. This is excellent for migration readiness.
            </Box>
          </Box>
        </Container>
      )}
    </SpaceBetween>
  )
}
