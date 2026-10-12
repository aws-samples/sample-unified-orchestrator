import { useState, useMemo } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Box,
  ProgressBar,
  Badge,
  Table,
  Pagination,
  TextFilter,
  ColumnLayout,
  Button,
  Modal,
  Tabs,
} from '@cloudscape-design/components'

interface ComponentDetail {
  publisher: string
  product: string
  full_version: string
  category: string
  subcategory?: string
  eosl_status: string
  eosl_date: string
  matched: boolean
  target_version: any
  target_eosl_date?: string
  compatibility_analysis?: any
  eosl_analysis?: any
}

interface MigrationReadinessTabProps {
  reportData?: any
  loading?: boolean
}

export default function MigrationReadinessTab({
  reportData,
  loading = false,
}: MigrationReadinessTabProps) {
  const [currentPageIndex, setCurrentPageIndex] = useState(1)
  const [pageSize] = useState(15)
  const [filteringText, setFilteringText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const [selectedRiskLevel, setSelectedRiskLevel] = useState<string>('')
  const [expandedModal, setExpandedModal] = useState<string | null>(null)
  const [componentTab, setComponentTab] = useState('matched')


  // If no report data, show placeholder
  if (!reportData && !loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <Box variant="h2" padding={{ bottom: 's' }}>
            No Assessment Data
          </Box>
          <Box variant="p" color="text-body-secondary">
            Select an application and click "Run Assessment" to view migration readiness.
          </Box>
        </Box>
      </Container>
    )
  }

  // Extract data from report
  const migrationReadiness = reportData?.migration_readiness || {}
  const migrationReadinessScore = migrationReadiness.readiness_score || 0
  const categories = reportData?.categories || {}

  // Extract all components from categories
  const allComponents: ComponentDetail[] = useMemo(() => {
    const components: ComponentDetail[] = []
    Object.keys(categories).forEach((categoryKey) => {
      const categoryComponents = categories[categoryKey] || []
      components.push(...categoryComponents)
    })
    return components
  }, [categories])

  // Get unique categories for filter
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>()
    allComponents.forEach(comp => {
      if (comp.category) cats.add(comp.category)
    })
    return Array.from(cats).sort()
  }, [allComponents])

  // Filter components based on text, category, and risk level
  const filteredComponents = useMemo(() => {
    let filtered = allComponents

    if (selectedCategory) {
      filtered = filtered.filter((component) => component.category === selectedCategory)
    }

    if (selectedRiskLevel) {
      filtered = filtered.filter((component) => {
        const riskLevel = component.compatibility_analysis?.overall_risk_level || 'Unknown'
        return riskLevel.toLowerCase() === selectedRiskLevel.toLowerCase()
      })
    }

    if (filteringText) {
      const lowerFilter = filteringText.toLowerCase()
      filtered = filtered.filter((component) => {
        return (
          component.publisher?.toLowerCase().includes(lowerFilter) ||
          component.product?.toLowerCase().includes(lowerFilter) ||
          component.category?.toLowerCase().includes(lowerFilter) ||
          component.subcategory?.toLowerCase().includes(lowerFilter)
        )
      })
    }

    return filtered
  }, [allComponents, filteringText, selectedCategory, selectedRiskLevel])
  if (loading) {
    return (
      <Container>
        <Box textAlign="center" padding="xxl">
          <ProgressBar label="Loading migration readiness data..." />
        </Box>
      </Container>
    )
  }

  const getScoreColor = (score: number): 'success' | 'in-progress' | 'error' => {
    if (score >= 70) return 'success'
    if (score >= 40) return 'in-progress'
    return 'error'
  }

  const getReadinessLabel = (score: number): string => {
    if (score >= 80) return 'Excellent'
    if (score >= 70) return 'Good'
    if (score >= 60) return 'Fair'
    if (score >= 40) return 'Poor'
    return 'Critical'
  }

  const getRiskLevelBadge = (riskLevel: string) => {
    const riskMap: Record<string, { color: 'green' | 'blue' | 'grey' | 'red'; label: string }> = {
      'Low': { color: 'green', label: 'Low' },
      'Medium': { color: 'blue', label: 'Medium' },
      'High': { color: 'red', label: 'High' },
      'Critical': { color: 'red', label: 'Critical' },
    }
    const badge = riskMap[riskLevel] || { color: 'grey', label: riskLevel }
    return <Badge color={badge.color}>{badge.label}</Badge>
  }

  return (
    <SpaceBetween size="l">
      {/* Overall Migration Readiness Score Section */}
      <Container
        header={
          <Header variant="h2" description="Overall technical readiness for migration (20% weight)">
            Migration Readiness Score
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Overall Migration Readiness Score</Box>
            <Box fontSize="display-l" fontWeight="bold">
              {migrationReadinessScore}/100
            </Box>
            <Box variant="small" color="text-status-info">
              {getReadinessLabel(migrationReadinessScore)}
            </Box>
          </Box>

          <ProgressBar
            value={migrationReadinessScore}
            variant="standalone"
            status={getScoreColor(migrationReadinessScore)}
            label="Migration Readiness Score"
            description={`${migrationReadinessScore}% - ${getReadinessLabel(migrationReadinessScore)}`}
          />
        </SpaceBetween>
      </Container>

      {/* Migration Readiness Factors */}
      <Container
        header={
          <Header variant="h2" description="Detailed breakdown of migration readiness factors">
            Readiness Factors
          </Header>
        }
      >
        <ColumnLayout columns={2} variant="text-grid">
          {/* Source Code Availability */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Source Code Availability (25% weight)</Box>
              {(migrationReadiness.scm_analysis?.source_code_repos as any[] | undefined)?.length ? <Button variant="icon" iconName="expand" ariaLabel="Expand" onClick={() => setExpandedModal('sourceCode')} /> : null}
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">
              {migrationReadiness.factors?.source_code_score || 0}/100
            </Box>
            <ProgressBar
              value={migrationReadiness.factors?.source_code_score || 0}
              variant="standalone"
              status={getScoreColor(migrationReadiness.factors?.source_code_score || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {migrationReadiness.factors?.source_code_available
                ? (() => {
                  const count = (migrationReadiness.scm_analysis?.source_code_repos as any[] | undefined)?.length || 0
                  return `Available (${count} ${count === 1 ? 'repository' : 'repositories'})`
                })()
                : 'Not Available'}
            </Box>
            {(() => {
              const repos = migrationReadiness.scm_analysis?.source_code_repos as any[] | undefined
              return repos && repos.length > 0 ? (
                <Box padding={{ top: 's' }}>
                  <div style={{ maxHeight: '175px', overflowY: 'auto' }}>
                    <Table
                      columnDefinitions={[
                        { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
                        { id: 'language', header: 'Language', cell: (item: any) => item.language || '—' },
                        {
                          id: 'url', header: 'Repository Link', cell: (item: any) => (
                            <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
                          )
                        },
                      ]}
                      items={repos}
                      variant="embedded"
                      stripedRows
                      sortingDisabled
                      wrapLines
                      ariaLabels={{ tableLabel: 'Source code repositories' }}
                      empty={
                        <Box textAlign="center" color="inherit">No repositories configured</Box>
                      }
                    />
                  </div>
                </Box>
              ) : null
            })()}
          </Box>

          {/* CI/CD Maturity */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">CI/CD Maturity (20% weight)</Box>
              {(migrationReadiness.scm_analysis?.cicd_details as any[] | undefined)?.length ? <Button variant="icon" iconName="expand" ariaLabel="Expand" onClick={() => setExpandedModal('cicd')} /> : null}
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">
              {migrationReadiness.factors?.cicd_score || 0}/100
            </Box>
            <ProgressBar
              value={migrationReadiness.factors?.cicd_score || 0}
              variant="standalone"
              status={getScoreColor(migrationReadiness.factors?.cicd_score || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {migrationReadiness.factors?.cicd_maturity || 'Unknown'}
            </Box>
            {(() => {
              const cicds = migrationReadiness.scm_analysis?.cicd_details as any[] | undefined
              return cicds && cicds.length > 0 ? (
                <Box padding={{ top: 's' }}>

                    <Table
                      columnDefinitions={[
                        { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
                        { id: 'maturity', header: 'Maturity', cell: (item: any) => item.maturity },
                        { id: 'tool', header: 'Tool', cell: (item: any) => item.tool },
                        { id: 'pipeline', header: 'Pipeline', cell: (item: any) => item.has_pipeline ? 'Yes' : 'No' },
                        { id: 'iac', header: 'IaC', cell: (item: any) => item.has_iac ? item.iac_tool : 'No' },
                        { id: 'stages', header: 'Stages', cell: (item: any) => item.stages },
                      ]}
                      items={cicds}
                      variant="embedded"
                      stripedRows
                      sortingDisabled
                      wrapLines
                      ariaLabels={{ tableLabel: 'CI/CD maturity per repository' }}
                      empty={
                        <Box textAlign="center" color="inherit">No CI/CD details available</Box>
                      }
                    />
                </Box>
              ) : null
            })()}
          </Box>

          {/* Target Version Availability */}
          <Box>
            <Box variant="awsui-key-label">Target Version Availability (20% weight)</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {migrationReadiness.factors?.target_version_score || 0}/100
            </Box>
            <ProgressBar
              value={migrationReadiness.factors?.target_version_score || 0}
              variant="standalone"
              status={getScoreColor(migrationReadiness.factors?.target_version_score || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {migrationReadiness.factors?.target_version_coverage || 0}% coverage
            </Box>
            {(() => {
              if (allComponents.length === 0) return null
              let currentMatchesTarget = 0
              let upgradeAvailable = 0
              let noTargetFound = 0
              allComponents.forEach((comp) => {
                if (!comp.matched) {
                  noTargetFound++
                } else if ((comp as any).keep_current) {
                  currentMatchesTarget++
                } else {
                  // matched but not keep_current — check if versions are the same
                  const currentVer = comp.full_version || ''
                  const targetVer = typeof comp.target_version === 'object'
                    ? comp.target_version?.version || ''
                    : comp.target_version || ''
                  if (currentVer && targetVer && currentVer === targetVer) {
                    currentMatchesTarget++
                  } else {
                    upgradeAvailable++
                  }
                }
              })
              const items = [
                { metric: 'Current Meets Target', value: currentMatchesTarget },
                { metric: 'Upgrade Available', value: upgradeAvailable },
                { metric: 'No Target Found', value: noTargetFound },
                { metric: 'Total Components', value: allComponents.length },
              ]
              return (
                <Box padding={{ top: 's' }}>

                    <Table
                      columnDefinitions={[
                        { id: 'metric', header: 'Metric', cell: (item: any) => item.metric },
                        { id: 'value', header: 'Count', cell: (item: any) => item.value },
                      ]}
                      items={items}
                      variant="embedded"
                      stripedRows
                      sortingDisabled
                      wrapLines
                      ariaLabels={{ tableLabel: 'Target version availability summary' }}
                      empty={
                        <Box textAlign="center" color="inherit">No component data available</Box>
                      }
                    />
                </Box>
              )
            })()}
          </Box>

          {/* Documentation Quality */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Documentation Quality (15% weight)</Box>
              {(migrationReadiness.scm_analysis?.documentation_details as any[] | undefined)?.length ? <Button variant="icon" iconName="expand" ariaLabel="Expand" onClick={() => setExpandedModal('docs')} /> : null}
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">
              {migrationReadiness.factors?.documentation_score || 0}/100
            </Box>
            <ProgressBar
              value={migrationReadiness.factors?.documentation_score || 0}
              variant="standalone"
              status={getScoreColor(migrationReadiness.factors?.documentation_score || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {migrationReadiness.factors?.documentation_quality || 'Unknown'}
            </Box>
            {(() => {
              const docs = migrationReadiness.scm_analysis?.documentation_details as any[] | undefined
              return docs && docs.length > 0 ? (
                <Box padding={{ top: 's' }}>

                    <Table
                      columnDefinitions={[
                        { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
                        { id: 'quality', header: 'Quality', cell: (item: any) => item.quality },
                        { id: 'readme', header: 'README', cell: (item: any) => item.has_readme ? 'Yes' : 'No' },
                        { id: 'api_docs', header: 'API Docs', cell: (item: any) => item.has_api_docs ? 'Yes' : 'No' },
                        { id: 'architecture', header: 'Architecture', cell: (item: any) => item.has_architecture ? 'Yes' : 'No' },
                      ]}
                      items={docs}
                      variant="embedded"
                      stripedRows
                      sortingDisabled
                      wrapLines
                      ariaLabels={{ tableLabel: 'Documentation quality per repository' }}
                      empty={
                        <Box textAlign="center" color="inherit">No documentation details available</Box>
                      }
                    />
                </Box>
              ) : null
            })()}
          </Box>

          {/* Monitoring Maturity */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Monitoring Maturity (10% weight)</Box>
              {(migrationReadiness.scm_analysis?.monitoring_details as any[] | undefined)?.length ? <Button variant="icon" iconName="expand" ariaLabel="Expand" onClick={() => setExpandedModal('monitoring')} /> : null}
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">
              {migrationReadiness.factors?.monitoring_score || 0}/100
            </Box>
            <ProgressBar
              value={migrationReadiness.factors?.monitoring_score || 0}
              variant="standalone"
              status={getScoreColor(migrationReadiness.factors?.monitoring_score || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {migrationReadiness.factors?.monitoring_maturity || 'Unknown'}
            </Box>
            {(() => {
              const mons = migrationReadiness.scm_analysis?.monitoring_details as any[] | undefined
              return mons && mons.length > 0 ? (
                <Box padding={{ top: 's' }}>

                    <Table
                      columnDefinitions={[
                        { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
                        { id: 'maturity', header: 'Maturity', cell: (item: any) => item.maturity },
                        { id: 'tools', header: 'Tools', cell: (item: any) => item.tools },
                        { id: 'logging', header: 'Logging', cell: (item: any) => item.has_logging ? 'Yes' : 'No' },
                        { id: 'tracing', header: 'Tracing', cell: (item: any) => item.has_tracing ? 'Yes' : 'No' },
                      ]}
                      items={mons}
                      variant="embedded"
                      stripedRows
                      sortingDisabled
                      wrapLines
                      ariaLabels={{ tableLabel: 'Monitoring maturity per repository' }}
                      empty={
                        <Box textAlign="center" color="inherit">No monitoring details available</Box>
                      }
                    />
                </Box>
              ) : null
            })()}
          </Box>

          {/* Code Coverage */}
          <Box>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box variant="awsui-key-label">Code Coverage (10% weight)</Box>
              {(migrationReadiness.scm_analysis?.coverage_details as any[] | undefined)?.length ? <Button variant="icon" iconName="expand" ariaLabel="Expand" onClick={() => setExpandedModal('coverage')} /> : null}
            </div>
            <Box fontSize="heading-xl" fontWeight="bold">
              {migrationReadiness.factors?.coverage_score || 0}/100
            </Box>
            <ProgressBar
              value={migrationReadiness.factors?.coverage_score || 0}
              variant="standalone"
              status={getScoreColor(migrationReadiness.factors?.coverage_score || 0)}
            />
            <Box variant="small" color="text-body-secondary" padding={{ top: 'xs' }}>
              {migrationReadiness.factors?.code_coverage || 0}% test coverage
            </Box>
            <Box variant="small" color="text-body-secondary">
              Coverage is extracted from committed report files (JaCoCo, Cobertura, LCOV) when available.
              If no report is found, coverage is estimated using the test-to-source file ratio.
            </Box>
            {(() => {
              const covs = migrationReadiness.scm_analysis?.coverage_details as any[] | undefined
              return covs && covs.length > 0 ? (
                <Box padding={{ top: 's' }}>

                    <Table
                      columnDefinitions={[
                        { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
                        { id: 'coverage', header: 'Coverage', cell: (item: any) => `${item.estimated_coverage}%` },
                        { id: 'source', header: 'Source', cell: (item: any) => item.coverage_source === 'coverage-report' ? 'Coverage Report' : 'File Ratio (est.)' },
                        { id: 'maturity', header: 'Maturity', cell: (item: any) => item.maturity },
                        { id: 'frameworks', header: 'Frameworks', cell: (item: any) => item.frameworks },
                      ]}
                      items={covs}
                      variant="embedded"
                      stripedRows
                      sortingDisabled
                      wrapLines
                      ariaLabels={{ tableLabel: 'Code coverage per repository' }}
                      empty={
                        <Box textAlign="center" color="inherit">No coverage details available</Box>
                      }
                    />
                </Box>
              ) : null
            })()}
          </Box>
        </ColumnLayout>
      </Container>

      {/* Component Details */}
      <Container
        header={
          <Header
            variant="h2"
            description="Components grouped by publisher and product"
            counter={`(${filteredComponents.length} of ${allComponents.length})`}
          >
            Component Details
          </Header>
        }
      >
        <SpaceBetween size="m">
          {/* Enhanced Filters */}
          <ColumnLayout columns={3}>
            <TextFilter
              filteringText={filteringText}
              filteringPlaceholder="Search by publisher, product, or category"
              filteringAriaLabel="Filter components"
              onChange={({ detail }) => {
                setFilteringText(detail.filteringText)
                setCurrentPageIndex(1)
              }}
              countText={`${filteredComponents.length} ${filteredComponents.length === 1 ? 'match' : 'matches'}`}
            />

            <Box>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                Category
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value)
                  setCurrentPageIndex(1)
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  fontSize: '14px'
                }}
              >
                <option value="">All Categories</option>
                {uniqueCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </Box>

            <Box>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: 500 }}>
                Risk Level
              </label>
              <select
                value={selectedRiskLevel}
                onChange={(e) => {
                  setSelectedRiskLevel(e.target.value)
                  setCurrentPageIndex(1)
                }}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                  fontSize: '14px'
                }}
              >
                <option value="">All Risk Levels</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Box>
          </ColumnLayout>

          <Box float="right">
            <Button onClick={() => { setFilteringText(''); setSelectedCategory(''); setSelectedRiskLevel(''); setCurrentPageIndex(1) }}>
              Clear Filters
            </Button>
          </Box>

          {/* Tabs: Matched / Unmatched / Upgrade Needed */}
          <Tabs
            activeTabId={componentTab}
            onChange={({ detail }) => { setComponentTab(detail.activeTabId); setCurrentPageIndex(1) }}
            tabs={(() => {
              const getTargetVer = (c: ComponentDetail) => {
                if (c.target_version && typeof c.target_version === 'object') return (c.target_version as any).version || ''
                return c.target_version || ''
              }
              const matched = filteredComponents.filter(c => {
                if (!c.matched) return false
                if ((c as any).keep_current) return true
                const currentVer = (c.full_version || '').trim()
                const targetVer = getTargetVer(c).trim()
                return currentVer === targetVer
              })
              const upgradeNeeded = filteredComponents.filter(c => {
                if (!c.matched) return false
                if ((c as any).keep_current) return false
                const currentVer = (c.full_version || '').trim()
                const targetVer = getTargetVer(c).trim()
                return currentVer !== targetVer && targetVer !== ''
              })
              const unmatched = filteredComponents.filter(c => !c.matched)

              const renderTab = (items: ComponentDetail[]) => {
                const pageItems = items.slice((currentPageIndex - 1) * pageSize, currentPageIndex * pageSize)
                if (!items.length) return <Box textAlign="center" padding="l" color="text-body-secondary">No components in this category.</Box>
                return (
                  <SpaceBetween size="m">
                    <Table
                      columnDefinitions={[
                        { id: 'publisher', header: 'Publisher', cell: (item: ComponentDetail) => item.publisher || '-', width: 180 },
                        { id: 'product', header: 'Product', cell: (item: ComponentDetail) => item.product || '-', width: 180 },
                        { id: 'category', header: 'Category', cell: (item: ComponentDetail) => item.subcategory || item.category || '-', width: 150 },
                        { id: 'current_version', header: 'Current Version', cell: (item: ComponentDetail) => item.full_version || '-', width: 120 },
                        { id: 'current_eosl', header: 'Current EOSL', cell: (item: ComponentDetail) => item.eosl_date || '-', width: 120 },
                        { id: 'target_version', header: 'Target Version', cell: (item: ComponentDetail) => getTargetVer(item) || 'Not Found', width: 140 },
                        { id: 'target_eosl', header: 'Target EOSL', cell: (item: ComponentDetail) => item.target_eosl_date || '-', width: 120 },
                        { id: 'compatibility', header: 'Compatibility Risk', cell: (item: ComponentDetail) => {
                          const analysis = item.compatibility_analysis
                          if (analysis && analysis.overall_risk_level) return getRiskLevelBadge(analysis.overall_risk_level)
                          return <Badge color="grey">Unknown</Badge>
                        }, width: 150 },
                      ]}
                      items={pageItems}
                      stripedRows wrapLines sortingDisabled
                    />
                    <Pagination
                      currentPageIndex={currentPageIndex}
                      pagesCount={Math.ceil(items.length / pageSize) || 1}
                      onChange={({ detail }) => setCurrentPageIndex(detail.currentPageIndex)}
                    />
                  </SpaceBetween>
                )
              }

              return [
                { id: 'matched', label: `Matched (${matched.length})`, content: renderTab(matched) },
                { id: 'unmatched', label: `Unmatched (${unmatched.length})`, content: renderTab(unmatched) },
                { id: 'upgrade', label: `Upgrade Needed (${upgradeNeeded.length})`, content: renderTab(upgradeNeeded) },
              ]
            })()}
          />
        </SpaceBetween>
      </Container>

      {/* Expand Modals for Readiness Factors */}
      <Modal visible={expandedModal === 'sourceCode'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`Source Code Repositories (${(migrationReadiness.scm_analysis?.source_code_repos as any[] | undefined)?.length || 0})`}>
        <Table columnDefinitions={[
          { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
          { id: 'language', header: 'Language', cell: (item: any) => item.language || '—' },
          { id: 'url', header: 'Repository Link', cell: (item: any) => <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a> },
        ]} items={(migrationReadiness.scm_analysis?.source_code_repos as any[]) || []} variant="embedded" stripedRows sortingDisabled wrapLines />
      </Modal>
      <Modal visible={expandedModal === 'cicd'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`CI/CD Maturity Details (${(migrationReadiness.scm_analysis?.cicd_details as any[] | undefined)?.length || 0})`}>
        <Table columnDefinitions={[
          { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
          { id: 'maturity', header: 'Maturity', cell: (item: any) => item.maturity },
          { id: 'tool', header: 'Tool', cell: (item: any) => item.tool },
          { id: 'pipeline', header: 'Pipeline', cell: (item: any) => item.has_pipeline ? 'Yes' : 'No' },
          { id: 'iac', header: 'IaC', cell: (item: any) => item.has_iac ? item.iac_tool : 'No' },
          { id: 'stages', header: 'Stages', cell: (item: any) => item.stages },
        ]} items={(migrationReadiness.scm_analysis?.cicd_details as any[]) || []} variant="embedded" stripedRows sortingDisabled wrapLines />
      </Modal>
      <Modal visible={expandedModal === 'docs'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`Documentation Quality Details (${(migrationReadiness.scm_analysis?.documentation_details as any[] | undefined)?.length || 0})`}>
        <Table columnDefinitions={[
          { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
          { id: 'quality', header: 'Quality', cell: (item: any) => item.quality },
          { id: 'readme', header: 'README', cell: (item: any) => item.has_readme ? 'Yes' : 'No' },
          { id: 'api_docs', header: 'API Docs', cell: (item: any) => item.has_api_docs ? 'Yes' : 'No' },
          { id: 'architecture', header: 'Architecture', cell: (item: any) => item.has_architecture ? 'Yes' : 'No' },
        ]} items={(migrationReadiness.scm_analysis?.documentation_details as any[]) || []} variant="embedded" stripedRows sortingDisabled wrapLines />
      </Modal>
      <Modal visible={expandedModal === 'monitoring'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`Monitoring Maturity Details (${(migrationReadiness.scm_analysis?.monitoring_details as any[] | undefined)?.length || 0})`}>
        <Table columnDefinitions={[
          { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
          { id: 'maturity', header: 'Maturity', cell: (item: any) => item.maturity },
          { id: 'tools', header: 'Tools', cell: (item: any) => item.tools },
          { id: 'logging', header: 'Logging', cell: (item: any) => item.has_logging ? 'Yes' : 'No' },
          { id: 'tracing', header: 'Tracing', cell: (item: any) => item.has_tracing ? 'Yes' : 'No' },
        ]} items={(migrationReadiness.scm_analysis?.monitoring_details as any[]) || []} variant="embedded" stripedRows sortingDisabled wrapLines />
      </Modal>
      <Modal visible={expandedModal === 'coverage'} onDismiss={() => setExpandedModal(null)} size="max"
        header={`Code Coverage Details (${(migrationReadiness.scm_analysis?.coverage_details as any[] | undefined)?.length || 0})`}>
        <Table columnDefinitions={[
          { id: 'repository', header: 'Repository', cell: (item: any) => item.repository },
          { id: 'coverage', header: 'Coverage', cell: (item: any) => `${item.estimated_coverage}%` },
          { id: 'source', header: 'Source', cell: (item: any) => item.coverage_source === 'coverage-report' ? 'Coverage Report' : 'File Ratio (est.)' },
          { id: 'maturity', header: 'Maturity', cell: (item: any) => item.maturity },
          { id: 'frameworks', header: 'Frameworks', cell: (item: any) => item.frameworks },
        ]} items={(migrationReadiness.scm_analysis?.coverage_details as any[]) || []} variant="embedded" stripedRows sortingDisabled wrapLines />
      </Modal>
    </SpaceBetween>
  )
}
