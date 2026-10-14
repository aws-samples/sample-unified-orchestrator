import { useState, useEffect, useMemo } from 'react'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Table,
  Box,
  Spinner,
  TextFilter,
  Pagination,
  StatusIndicator,
  Container,
  ColumnLayout,
  ExpandableSection,
  TableProps,
} from '@cloudscape-design/components'
import { iacAgentApi } from '../services/iacAgent'
import { useIacDocsPanel } from '../hooks/useIacDocsPanel'

interface BlueprintRecord {
  blueprint_name: string
  display_name?: string
  version: string
  blueprint_type?: string
  description?: string
  is_active?: boolean
  input_schema?: Record<string, unknown>
  output_schema?: Record<string, unknown>
  origin?: string
  owner?: string
  tags?: string[]
  estimated_duration?: string
  [key: string]: unknown
}

const PAGE_SIZE = 20

/* ------------------------------------------------------------------ */
/*  Human-readable JSON-Schema renderer                               */
/* ------------------------------------------------------------------ */

interface SchemaProp {
  type?: string | string[]
  description?: string
  enum?: string[]
  default?: unknown
  pattern?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  properties?: Record<string, SchemaProp>
  items?: SchemaProp
  required?: string[]
  patternProperties?: Record<string, SchemaProp>
  additionalProperties?: SchemaProp | boolean
}

interface SchemaRoot extends SchemaProp {
  title?: string
  description?: string
}

function formatType(t: string | string[] | undefined): string {
  if (!t) return 'any'
  if (Array.isArray(t)) return t.filter((v) => v !== 'null').join(' | ') + (t.includes('null') ? '?' : '')
  return t
}

function Constraints({ prop }: { prop: SchemaProp }) {
  const parts: string[] = []
  if (prop.enum) parts.push(`values: ${prop.enum.join(', ')}`)
  if (prop.pattern) parts.push(`pattern: ${prop.pattern}`)
  if (prop.minimum !== undefined) parts.push(`min: ${prop.minimum}`)
  if (prop.maximum !== undefined) parts.push(`max: ${prop.maximum}`)
  if (prop.minLength !== undefined) parts.push(`minLength: ${prop.minLength}`)
  if (prop.maxLength !== undefined) parts.push(`maxLength: ${prop.maxLength}`)
  if (parts.length === 0) return null
  return <Box variant="small" color="text-body-secondary">{parts.join(' · ')}</Box>
}

function PropertyRow({ name, prop, required, depth = 0 }: { name: string; prop: SchemaProp; required: boolean; depth?: number }) {
  const hasChildren = prop.properties || prop.items?.properties || prop.patternProperties
  const childRequired = prop.required ?? prop.items?.required ?? []

  const childProps: Record<string, SchemaProp> = {
    ...(prop.properties ?? {}),
    ...(prop.items?.properties ?? {}),
  }
  // Merge patternProperties (e.g. "^[0-9]{2}$") as a single representative entry
  if (prop.patternProperties) {
    for (const [pat, schema] of Object.entries(prop.patternProperties)) {
      childProps[`[${pat}]`] = schema
    }
  }

  const label = (
    <div style={{ paddingLeft: depth * 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Box variant="code" fontSize="body-s">{name}</Box>
        <span style={{
          fontSize: 11, padding: '1px 6px', borderRadius: 4,
          background: 'var(--color-background-badge-color, #e9ebed)', color: 'var(--color-text-body-secondary, #5f6b7a)',
        }}>
          {formatType(prop.type ?? prop.items?.type)}
          {prop.type === 'array' && prop.items ? '[]' : ''}
        </span>
        {required && (
          <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#fce9e0', color: '#d13212' }}>
            required
          </span>
        )}
        {prop.default !== undefined && (
          <Box variant="small" color="text-body-secondary">default: {JSON.stringify(prop.default)}</Box>
        )}
      </div>
      {prop.description && <Box variant="small" color="text-body-secondary">{prop.description}</Box>}
      <Constraints prop={prop} />
    </div>
  )

  if (hasChildren && Object.keys(childProps).length > 0) {
    return (
      <>
        <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-divider-default, #e9ebed)' }}>
          <ExpandableSection headerText="" header={label} variant="footer">
            <div style={{ paddingTop: 4 }}>
              {Object.entries(childProps).map(([k, v]) => (
                <PropertyRow key={k} name={k} prop={v} required={childRequired.includes(k)} depth={0} />
              ))}
            </div>
          </ExpandableSection>
        </div>
      </>
    )
  }

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-divider-default, #e9ebed)' }}>
      {label}
    </div>
  )
}

function SchemaBlock({ label, data }: { label: string; data: unknown }) {
  if (!data) return null

  let schema: SchemaRoot
  if (typeof data === 'string') {
    try { schema = JSON.parse(data) as SchemaRoot } catch { return null }
  } else {
    schema = data as SchemaRoot
  }

  const properties = schema.properties ?? {}
  const requiredFields = schema.required ?? []

  if (Object.keys(properties).length === 0) {
    return (
      <SpaceBetween size="xxs">
        <Box variant="h4">{label}</Box>
        <Box variant="small" color="text-body-secondary">No properties defined.</Box>
      </SpaceBetween>
    )
  }

  return (
    <SpaceBetween size="xxs">
      <Box variant="h4">{label}</Box>
      {schema.description && <Box variant="small" color="text-body-secondary">{schema.description}</Box>}
      <div>
        {Object.entries(properties).map(([name, prop]) => (
          <PropertyRow key={name} name={name} prop={prop} required={requiredFields.includes(name)} />
        ))}
      </div>
    </SpaceBetween>
  )
}

function BlueprintDetail({ item }: { item: BlueprintRecord }) {
  return (
    <Container header={<Header variant="h3">{item.display_name ?? item.blueprint_name} — Detail</Header>}>
      <SpaceBetween size="s">
        <ColumnLayout columns={2} variant="text-grid">
          {item.origin && (
            <div>
              <Box variant="awsui-key-label">Origin</Box>
              <Box variant="code">{item.origin}</Box>
            </div>
          )}
          {item.owner && (
            <div>
              <Box variant="awsui-key-label">Owner</Box>
              <div>{item.owner}</div>
            </div>
          )}
          {item.tags && item.tags.length > 0 && (
            <div>
              <Box variant="awsui-key-label">Tags</Box>
              <div>{item.tags.join(', ')}</div>
            </div>
          )}
          {item.estimated_duration && (
            <div>
              <Box variant="awsui-key-label">Estimated Duration</Box>
              <div>{item.estimated_duration}</div>
            </div>
          )}
        </ColumnLayout>
        <ColumnLayout columns={2}>
          <SchemaBlock label="Input Schema" data={item.input_schema} />
          <SchemaBlock label="Output Schema" data={item.output_schema} />
        </ColumnLayout>
      </SpaceBetween>
    </Container>
  )
}

export default function BlueprintCatalogPage() {
  useIacDocsPanel()
  const [blueprints, setBlueprints] = useState<BlueprintRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterText, setFilterText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [sortingColumn, setSortingColumn] = useState<TableProps.SortingColumn<BlueprintRecord>>({ sortingField: 'blueprint_name' })
  const [sortingDescending, setSortingDescending] = useState(false)
  const [selectedItems, setSelectedItems] = useState<BlueprintRecord[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        const res = await iacAgentApi.listBlueprints()
        setBlueprints(res.data as unknown as BlueprintRecord[])
      } catch (err) {
        console.error('Failed to load blueprints:', err)
        setError('Failed to load blueprints. Check that the backend is running.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    if (!filterText) return blueprints
    const lower = filterText.toLowerCase()
    return blueprints.filter(
      (b) =>
        b.blueprint_name.toLowerCase().includes(lower) ||
        (b.display_name ?? '').toLowerCase().includes(lower) ||
        (b.description ?? '').toLowerCase().includes(lower)
    )
  }, [blueprints, filterText])

  const sorted = useMemo(() => {
    const field = sortingColumn.sortingField as keyof BlueprintRecord | undefined
    if (!field) return filtered
    const copy = [...filtered]
    copy.sort((a, b) => {
      const aVal = String(a[field] ?? '')
      const bVal = String(b[field] ?? '')
      return sortingDescending ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal)
    })
    return copy
  }, [filtered, sortingColumn, sortingDescending])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageItems = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  useEffect(() => {
    setCurrentPage(1)
  }, [filterText])

  const columnDefinitions: TableProps.ColumnDefinition<BlueprintRecord>[] = [
    { id: 'blueprint_name', header: 'Blueprint Name', cell: (item) => item.blueprint_name, sortingField: 'blueprint_name', width: 200 },
    { id: 'display_name', header: 'Display Name', cell: (item) => item.display_name ?? '-', sortingField: 'display_name', width: 200 },
    { id: 'version', header: 'Version', cell: (item) => item.version, sortingField: 'version', width: 100 },
    { id: 'blueprint_type', header: 'Type', cell: (item) => item.blueprint_type ?? '-', sortingField: 'blueprint_type', width: 120 },
    { id: 'description', header: 'Description', cell: (item) => item.description ?? '-', width: 300 },
    {
      id: 'is_active', header: 'Active', width: 100, sortingField: 'is_active',
      cell: (item) =>
        item.is_active === undefined ? '-'
          : item.is_active ? <StatusIndicator type="success">Yes</StatusIndicator>
          : <StatusIndicator type="stopped">No</StatusIndicator>,
    },
  ]

  if (loading) {
    return (
      <ContentLayout header={<Header variant="h1">Infra Blueprints</Header>}>
        <Box textAlign="center" padding="l"><Spinner size="large" /><Box>Loading blueprints...</Box></Box>
      </ContentLayout>
    )
  }

  if (error) {
    return (
      <ContentLayout header={<Header variant="h1">Infra Blueprints</Header>}>
        <Box textAlign="center" padding="l" color="text-status-error">{error}</Box>
      </ContentLayout>
    )
  }

  return (
    <ContentLayout
      header={<Header variant="h1" counter={`(${filtered.length})`} description="Browse available infrastructure blueprints for application composition">Infra Blueprints</Header>}
    >
      <SpaceBetween size="l">
        <Table
          columnDefinitions={columnDefinitions}
          items={pageItems}
          selectionType="single"
          selectedItems={selectedItems}
          onSelectionChange={({ detail }) => setSelectedItems(detail.selectedItems)}
          sortingColumn={sortingColumn}
          sortingDescending={sortingDescending}
          onSortingChange={({ detail }) => { setSortingColumn(detail.sortingColumn); setSortingDescending(detail.isDescending ?? false) }}
          filter={<TextFilter filteringText={filterText} filteringPlaceholder="Search blueprints by name or description" onChange={({ detail }) => setFilterText(detail.filteringText)} />}
          pagination={<Pagination currentPageIndex={currentPage} pagesCount={totalPages} onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)} />}
          empty={<Box textAlign="center" color="inherit"><b>No blueprints found</b><Box padding={{ bottom: 's' }} variant="p" color="inherit">No blueprints match the current filter.</Box></Box>}
          header={<Header counter={`(${filtered.length})`}>Blueprints</Header>}
        />
        {selectedItems.length > 0 && <BlueprintDetail item={selectedItems[0]} />}
      </SpaceBetween>
    </ContentLayout>
  )
}
