import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Table,
  Header,
  SpaceBetween,
  Box,
  TextFilter,
  Pagination,
  Button,
  StatusIndicator,
  ContentLayout,
  Spinner,
  Alert,
  Modal,
} from '@cloudscape-design/components'
import { iacAgentApi } from '../services/iacAgent'
import { ROUTES } from '../constants'
import { getEnvironmentKeys, getActiveStates } from '../utils/sessionStatusUtils'
import { useSessionStatuses } from '../hooks/useSessionStatuses'
import SessionIndicator from '../components/SessionIndicator'
import GenerateFromCompositionModal from './GenerateFromCompositionModal'
import { useIacDocsPanel } from '../hooks/useIacDocsPanel'

interface AppCatalogRecord {
  mots_id: string
  app_name?: string
  app_composition?: string | { blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[] }
  status?: string
  updated_at?: string
  created_at?: string
  [key: string]: unknown
}

function parseComposition(raw: unknown): { blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[] } | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw as ReturnType<typeof parseComposition>
}

export default function AppCompositionsPage() {
  useIacDocsPanel()
  const navigate = useNavigate()
  const [items, setItems] = useState<AppCatalogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterText, setFilterText] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20
  const [sortingColumn, setSortingColumn] = useState<{ sortingField: string }>({ sortingField: 'mots_id' })
  const [sortingDescending, setSortingDescending] = useState(false)

  // Session status hook
  const { sessionStatuses, refreshAll, refreshRow, isRefreshingAll, refreshingRows } = useSessionStatuses()

  // Generate modal state
  const [generateMotsId, setGenerateMotsId] = useState('')
  const [generateEnvironments, setGenerateEnvironments] = useState<string[]>([])
  const [showGenerateModal, setShowGenerateModal] = useState(false)

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteMotsId, setDeleteMotsId] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleGenerated = (genMotsId: string, genEnvironment: string) => {
    setShowGenerateModal(false)
    navigate(`${ROUTES.COMPOSER}?mots_id=${genMotsId}&environment=${genEnvironment}`)
  }

  const handleNavigateToComposer = (motsId: string, environment: string) => {
    navigate(`${ROUTES.COMPOSER}?mots_id=${motsId}&environment=${environment}`)
  }

  const handleDeleteClick = (motsId: string) => {
    setDeleteMotsId(motsId)
    setDeleteError(null)
    setShowDeleteModal(true)
  }

  const handleDeleteConfirm = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await iacAgentApi.deleteComposition(deleteMotsId)
      setShowDeleteModal(false)
      setItems(prev => prev.filter(i => i.mots_id !== deleteMotsId))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string }
      setDeleteError(axiosErr.response?.data?.detail || axiosErr.message || 'Failed to delete composition')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteCancel = () => {
    setShowDeleteModal(false)
    setDeleteError(null)
  }

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await iacAgentApi.listAppCatalogs()
        const loadedItems = data as AppCatalogRecord[]
        setItems(loadedItems)
      } catch {
        setError('Failed to load app compositions')
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = items.filter((item) => {
    const text = filterText.toLowerCase()
    return (
      item.mots_id?.toLowerCase().includes(text) ||
      item.app_name?.toLowerCase().includes(text)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    const field = sortingColumn.sortingField as keyof AppCatalogRecord
    const aVal = String(a[field] ?? '')
    const bVal = String(b[field] ?? '')
    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
    return sortingDescending ? -cmp : cmp
  })

  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  if (loading) {
    return (
      <ContentLayout header={<Header variant="h1">App Compositions</Header>}>
        <Box textAlign="center" padding="xl"><Spinner size="large" /></Box>
      </ContentLayout>
    )
  }

  if (error) {
    return (
      <ContentLayout header={<Header variant="h1">App Compositions</Header>}>
        <Alert type="error">{error}</Alert>
      </ContentLayout>
    )
  }

  return (
    <ContentLayout header={<Header variant="h1">App Compositions</Header>}>
      <Table
        sortingColumn={sortingColumn}
        sortingDescending={sortingDescending}
        onSortingChange={({ detail }) => {
          setSortingColumn(detail.sortingColumn as { sortingField: string })
          setSortingDescending(detail.isDescending ?? false)
        }}
        header={
          <Header
            counter={`(${sorted.length})`}
            actions={
              <Button
                iconName="refresh"
                ariaLabel="Refresh session statuses"
                loading={isRefreshingAll}
                onClick={() => refreshAll(items)}
              />
            }
          >
            Compositions
          </Header>
        }
        items={paginated}
        columnDefinitions={[
          {
            id: 'mots_id',
            header: 'MOTS ID',
            cell: (item) => item.mots_id,
            sortingField: 'mots_id',
          },
          {
            id: 'app_name',
            header: 'App Name',
            cell: (item) => item.app_name ?? '—',
            sortingField: 'app_name',
          },
          {
            id: 'blueprints',
            header: 'Blueprints',
            cell: (item) => {
              const comp = parseComposition(item.app_composition)
              return comp?.blueprints?.length ?? 0
            },
          },
          {
            id: 'environments',
            header: 'Environments',
            cell: (item) => {
              const envs = getEnvironmentKeys(item)
              return envs.length > 0 ? envs.join(', ') : '—'
            },
          },
          {
            id: 'status',
            header: 'Status',
            cell: (item) => {
              const s = item.status ?? 'unknown'
              const type = s === 'composition_created' ? 'success' : 'info'
              return <StatusIndicator type={type}>{s}</StatusIndicator>
            },
            sortingField: 'status',
          },
          {
            id: 'updated_at',
            header: 'Last Updated',
            cell: (item) => item.updated_at
              ? new Date(item.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—',
            sortingField: 'updated_at',
          },
          {
            id: 'actions',
            header: 'Actions',
            cell: (item) => {
              const envs = getEnvironmentKeys(item)
              const activeStates = getActiveStates(item.mots_id, envs, sessionStatuses)
              const hasActiveSession = activeStates.length > 0
              const showPrefix = activeStates.length > 1

              return (
                <SpaceBetween direction="horizontal" size="xs">
                  <Button variant="inline-link" onClick={() => navigate(`${ROUTES.COMPOSITIONS}/${item.mots_id}/edit`)}>
                    Edit
                  </Button>
                  {hasActiveSession ? (
                    activeStates.map(({ environment, pageState }) => (
                      <SessionIndicator
                        key={`${item.mots_id}:${environment}`}
                        state={pageState.state as 'generating' | 'review' | 'approved' | 'error'}
                        environment={environment}
                        motsId={item.mots_id}
                        showEnvironmentPrefix={showPrefix}
                        onNavigate={handleNavigateToComposer}
                      />
                    ))
                  ) : (
                    <Button variant="inline-link" onClick={() => {
                      setGenerateMotsId(item.mots_id)
                      setGenerateEnvironments(envs)
                      setShowGenerateModal(true)
                    }}>
                      Generate
                    </Button>
                  )}
                  {envs.length > 0 && (
                    <Button
                      iconName="refresh"
                      variant="inline-icon"
                      ariaLabel={`Refresh status for ${item.mots_id}`}
                      loading={refreshingRows.has(item.mots_id)}
                      onClick={() => refreshRow(item.mots_id, envs)}
                    />
                  )}
                  <Button
                    iconName="remove"
                    variant="inline-icon"
                    ariaLabel={hasActiveSession ? `Cannot delete ${item.mots_id} while a session is active` : 'Delete composition'}
                    disabled={hasActiveSession}
                    onClick={() => handleDeleteClick(item.mots_id)}
                  />
                  <Button variant="inline-link" onClick={() => navigate(`${ROUTES.SESSION_HISTORY}?mots_id=${item.mots_id}`)}>
                    History
                  </Button>
                </SpaceBetween>
              )
            },
          },
        ]}
        filter={
          <TextFilter
            filteringText={filterText}
            filteringPlaceholder="Search by MOTS ID or app name"
            onChange={({ detail }) => { setFilterText(detail.filteringText); setCurrentPage(1) }}
          />
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={Math.ceil(sorted.length / pageSize)}
            onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
          />
        }
        empty={
          <Box textAlign="center" padding="xl">
            <Box variant="p">No app compositions found.</Box>
          </Box>
        }
      />
      <GenerateFromCompositionModal
        visible={showGenerateModal}
        motsId={generateMotsId}
        availableEnvironments={generateEnvironments}
        onDismiss={() => setShowGenerateModal(false)}
        onGenerated={handleGenerated}
      />
      <Modal
        visible={showDeleteModal}
        onDismiss={handleDeleteCancel}
        header="Delete composition"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={handleDeleteCancel} disabled={isDeleting}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleDeleteConfirm} loading={isDeleting} disabled={isDeleting}>
                Delete
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {deleteError && <Alert type="error">{deleteError}</Alert>}
          <Box>
            Are you sure you want to delete composition <strong>{deleteMotsId}</strong>? This action cannot be undone.
          </Box>
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  )
}
