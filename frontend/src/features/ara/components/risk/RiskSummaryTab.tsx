import { useState } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Box,
  ProgressBar,
  Badge,
  Table,
  ColumnLayout,
  PropertyFilter,
  PropertyFilterProps,
} from '@cloudscape-design/components'

interface ActionableItem {
  id: string
  type: 'target_gap' | 'eosl' | 'category_gap' | 'scm_missing'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  recommendation?: string
}

interface RiskSummaryTabProps {
  data?: any
  loading?: boolean
  assessmentData?: any
  reportData?: any
}

export default function RiskSummaryTab({ data, loading = false, assessmentData, reportData }: RiskSummaryTabProps) {
  // State for filtering and sorting
  const [filteringQuery, setFilteringQuery] = useState<PropertyFilterProps.Query>({
    tokens: [],
    operation: 'and',
  })
  const [sortingColumn, setSortingColumn] = useState<{ sortingField: string; isDescending?: boolean }>({
    sortingField: 'severity',
    isDescending: false,
  })

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
            Select an application and click "Run Assessment" to view risk analysis results.
          </Box>
        </Box>
      </Container>
    )
  }

  // Extract data
  const overallScore = report?.overall_score || report?.scores?.overall_readiness_score || 0
  const actionableItems = report?.actionable_items || []
  const scores = report?.scores || {}

  // Define filtering properties for PropertyFilter
  const filteringProperties: PropertyFilterProps.FilteringProperty[] = [
    {
      key: 'type',
      propertyLabel: 'Type',
      groupValuesLabel: 'Type values',
      operators: ['=', '!='],
    },
    {
      key: 'severity',
      propertyLabel: 'Severity',
      groupValuesLabel: 'Severity values',
      operators: ['=', '!='],
    },
    {
      key: 'title',
      propertyLabel: 'Title',
      groupValuesLabel: 'Title values',
      operators: [':', '!:', '=', '!='],
    },
    {
      key: 'description',
      propertyLabel: 'Description',
      groupValuesLabel: 'Description values',
      operators: [':', '!:', '=', '!='],
    },
  ]

  // Apply filtering
  const applyFiltering = (items: ActionableItem[]): ActionableItem[] => {
    if (!filteringQuery.tokens || filteringQuery.tokens.length === 0) {
      return items
    }

    return items.filter((item) => {
      return filteringQuery.tokens!.every((token: any) => {
        const propertyKey = token.propertyKey as keyof ActionableItem
        const itemValue = String(item[propertyKey] || '').toLowerCase()
        const tokenValue = String(token.value).toLowerCase()

        switch (token.operator) {
          case '=':
            return itemValue === tokenValue
          case '!=':
            return itemValue !== tokenValue
          case ':':
            return itemValue.includes(tokenValue)
          case '!:':
            return !itemValue.includes(tokenValue)
          default:
            return true
        }
      })
    })
  }

  // Apply sorting
  const applySorting = (items: ActionableItem[]): ActionableItem[] => {
    if (!sortingColumn.sortingField) {
      return items
    }

    const sortedItems = [...items]
    const field = sortingColumn.sortingField as keyof ActionableItem

    sortedItems.sort((a, b) => {
      let aValue: string | number | undefined = a[field]
      let bValue: string | number | undefined = b[field]

      // Handle severity sorting with custom order
      if (field === 'severity') {
        const severityOrder: Record<string, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        }
        aValue = severityOrder[aValue as string] ?? 999
        bValue = severityOrder[bValue as string] ?? 999
      }

      // Handle type sorting with custom order
      if (field === 'type') {
        const typeOrder: Record<string, number> = {
          target_gap: 0,
          eosl: 1,
          scm_missing: 2,
          category_gap: 3,
          integration: 4,
          app_type: 5,
          testing: 6,
        }
        aValue = typeOrder[aValue as string] ?? 999
        bValue = typeOrder[bValue as string] ?? 999
      }

      // Convert to string for comparison if not already a number
      if (typeof aValue !== 'number') {
        aValue = String(aValue || '').toLowerCase()
      }
      if (typeof bValue !== 'number') {
        bValue = String(bValue || '').toLowerCase()
      }

      if (aValue < bValue) {
        return sortingColumn.isDescending ? 1 : -1
      }
      if (aValue > bValue) {
        return sortingColumn.isDescending ? -1 : 1
      }
      return 0
    })

    return sortedItems
  }

  // Process items with filtering and sorting
  const processedItems = applySorting(applyFiltering(actionableItems))

  const getScoreColor = (score: number): 'success' | 'in-progress' | 'error' => {
    if (score >= 70) return 'success'
    if (score >= 40) return 'in-progress'
    return 'error'
  }

  const getScoreLabel = (score: number): string => {
    if (score >= 80) return 'Excellent'
    if (score >= 70) return 'Good'
    if (score >= 60) return 'Fair'
    if (score >= 40) return 'Poor'
    return 'Critical'
  }

  const getSeverityBadge = (severity: string) => {
    const colorMap: Record<string, 'red' | 'blue' | 'grey'> = {
      critical: 'red',
      high: 'red',
      medium: 'blue',
      low: 'grey',
    }
    return <Badge color={colorMap[severity] || 'grey'}>{severity.toUpperCase()}</Badge>
  }

  const getTypeBadge = (type: string) => {
    const labelMap: Record<string, string> = {
      target_gap: 'Target Gap',
      eosl: 'EOSL Risk',
      category_gap: 'Category Gap',
      scm_missing: 'SCM Missing',
      integration: 'Integration',
      app_type: 'App Type',
      testing: 'Testing',
    }
    return <Badge>{labelMap[type] || type}</Badge>
  }

  return (
    <SpaceBetween size="l">
      {/* Overall Application Readiness Score Section */}
      <Container
        header={
          <Header variant="h2" description="Overall migration priority assessment">
            Application Readiness Score
          </Header>
        }
      >
        <SpaceBetween size="m">
          <Box>
            <Box variant="awsui-key-label">Overall Application Readiness Score</Box>
            <Box fontSize="display-l" fontWeight="bold">
              {overallScore}/100
            </Box>
            <Box variant="small" color="text-status-info">
              {getScoreLabel(overallScore)}
            </Box>
          </Box>

          <ProgressBar
            value={overallScore}
            variant="standalone"
            status={getScoreColor(overallScore)}
            label="Application Readiness Score"
            description={`${overallScore}% - ${getScoreLabel(overallScore)}`}
          />
        </SpaceBetween>
      </Container>

      {/* Score Summary */}
      <Container
        header={
          <Header variant="h2" description="Summary of all assessment dimensions">
            Score Summary
          </Header>
        }
      >
        <ColumnLayout columns={3} variant="text-grid">
          <Box>
            <Box variant="awsui-key-label">Risk Score</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {scores.risk_score || 0}
            </Box>
            <ProgressBar
              value={scores.risk_score || 0}
              variant="standalone"
              status={getScoreColor(scores.risk_score || 0)}
            />
          </Box>
          <Box>
            <Box variant="awsui-key-label">Complexity Score</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {scores.complexity_score || 0}
            </Box>
            <ProgressBar
              value={scores.complexity_score || 0}
              variant="standalone"
              status={getScoreColor(scores.complexity_score || 0)}
            />
          </Box>
          <Box>
            <Box variant="awsui-key-label">Migration Readiness</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {scores.migration_readiness_score || 0}
            </Box>
            <ProgressBar
              value={scores.migration_readiness_score || 0}
              variant="standalone"
              status={getScoreColor(scores.migration_readiness_score || 0)}
            />
          </Box>
          <Box>
            <Box variant="awsui-key-label">Team Readiness</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {scores.team_readiness_score || 0}
            </Box>
            <ProgressBar
              value={scores.team_readiness_score || 0}
              variant="standalone"
              status={getScoreColor(scores.team_readiness_score || 0)}
            />
          </Box>
          <Box>
            <Box variant="awsui-key-label">Business Readiness</Box>
            <Box fontSize="heading-xl" fontWeight="bold">
              {scores.business_readiness_score || 0}
            </Box>
            <ProgressBar
              value={scores.business_readiness_score || 0}
              variant="standalone"
              status={getScoreColor(scores.business_readiness_score || 0)}
            />
          </Box>
        </ColumnLayout>
      </Container>

      {/* Actionable Items Section */}
      <Container
        header={
          <Header
            variant="h2"
            description="Critical items requiring attention before migration"
            counter={`(${processedItems.length})`}
          >
            Actionable Items
          </Header>
        }
      >
        <Table
          columnDefinitions={[
            {
              id: 'type',
              header: 'Type',
              cell: (item: ActionableItem) => getTypeBadge(item.type),
              width: 150,
              sortingField: 'type',
            },
            {
              id: 'severity',
              header: 'Severity',
              cell: (item: ActionableItem) => getSeverityBadge(item.severity),
              width: 120,
              sortingField: 'severity',
            },
            {
              id: 'title',
              header: 'Title',
              cell: (item: ActionableItem) => item.title,
              sortingField: 'title',
            },
            {
              id: 'description',
              header: 'Description',
              cell: (item: ActionableItem) => item.description,
              sortingField: 'description',
            },
            {
              id: 'recommendation',
              header: 'Recommendation',
              cell: (item: ActionableItem) => item.recommendation || '-',
            },
          ]}
          items={processedItems}
          loadingText="Loading actionable items"
          loading={loading}
          sortingColumn={sortingColumn}
          onSortingChange={({ detail }: any) =>
            setSortingColumn({
              sortingField: detail.sortingColumn.sortingField || 'severity',
              isDescending: detail.isDescending,
            })
          }
          filter={
            <PropertyFilter
              query={filteringQuery}
              onChange={({ detail }: any) => setFilteringQuery(detail)}
              filteringProperties={filteringProperties}
              filteringPlaceholder="Filter actionable items"
              filteringAriaLabel="Filter actionable items"
              countText={`${processedItems.length} ${processedItems.length === 1 ? 'match' : 'matches'}`}
            />
          }
          empty={
            <Box textAlign="center" color="inherit">
              <Box variant="p" color="inherit">
                No actionable items found
              </Box>
            </Box>
          }
        />
      </Container>
    </SpaceBetween>
  )
}
