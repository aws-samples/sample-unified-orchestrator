import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Tabs,
  Table,
  Badge,
  Button,
  Box,
  Modal,
  FormField,
  Textarea,
  Input,
  Alert,
  ExpandableSection,
} from '@cloudscape-design/components'
import {
  iacAgentApi,
  ConfigVersion,
  CreateConfigVersionPayload,
  UpdateConfigVersionPayload,
} from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'
import { ROUTES } from '../../constants'
import { useIacDocsPanel } from '../../hooks/useIacDocsPanel'

type ConfigType = 'system_prompt' | 'brics_workflow'

const TAB_CONFIG: { id: ConfigType; label: string }[] = [
  { id: 'system_prompt', label: 'System Prompt' },
  { id: 'brics_workflow', label: 'BRICS Workflow' },
]

function statusBadge(status: string) {
  switch (status) {
    case 'active':
      return <Badge color="green">Active</Badge>
    case 'draft':
      return <Badge color="blue">Draft</Badge>
    default:
      return <Badge color="grey">Inactive</Badge>
  }
}

export default function AgentSettingsPage() {
  useIacDocsPanel()
  const [activeTab, setActiveTab] = useState<ConfigType>('system_prompt')
  const [versions, setVersions] = useState<ConfigVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Upload modal state
  const [showUpload, setShowUpload] = useState(false)
  const [uploadContent, setUploadContent] = useState('')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploading, setUploading] = useState(false)

  // Edit modal state
  const [editVersion, setEditVersion] = useState<ConfigVersion | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editing, setEditing] = useState(false)

  // Delete confirmation state
  const [deleteVersion, setDeleteVersion] = useState<ConfigVersion | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Activate loading state
  const [activating, setActivating] = useState('')

  // View expanded row
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)

  // Draft selection for testing (one per config type)
  const [selectedDrafts, setSelectedDrafts] = useState<Record<string, string>>({})
  const navigate = useNavigate()

  const toggleDraftSelection = (item: ConfigVersion) => {
    setSelectedDrafts((prev) => {
      const key = activeTab
      if (prev[key] === item.sk) {
        // Deselect
        const next = { ...prev }
        delete next[key]
        return next
      }
      // Select (replaces any previous selection for this tab)
      return { ...prev, [key]: item.sk }
    })
  }

  const handleTestConfig = () => {
    const overrideParam = Object.entries(selectedDrafts)
      .map(([type, version]) => `${type}:${version}`)
      .join(',')
    navigate(`${ROUTES.COMPOSER}?test_overrides=${overrideParam}`)
  }

  const hasSelectedDrafts = Object.keys(selectedDrafts).length > 0

  const fetchVersions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await iacAgentApi.listConfigVersions(activeTab)
      setVersions(data)
    } catch (err) {
      setError(extractApiError(err, 'Failed to load versions'))
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    fetchVersions()
  }, [fetchVersions])

  const handleUpload = async () => {
    setUploading(true)
    setError('')
    try {
      const payload: CreateConfigVersionPayload = {
        content: uploadContent,
        created_by: 'admin',
        description: uploadDescription,
      }
      await iacAgentApi.createConfigVersion(activeTab, payload)
      setShowUpload(false)
      setUploadContent('')
      setUploadDescription('')
      await fetchVersions()
    } catch (err) {
      setError(extractApiError(err, 'Failed to upload version'))
    } finally {
      setUploading(false)
    }
  }

  const handleEdit = async () => {
    if (!editVersion) return
    setEditing(true)
    setError('')
    try {
      const payload: UpdateConfigVersionPayload = {
        content: editContent,
        description: editDescription,
      }
      await iacAgentApi.updateConfigVersion(activeTab, editVersion.sk, payload)
      setEditVersion(null)
      await fetchVersions()
    } catch (err) {
      setError(extractApiError(err, 'Failed to update version'))
    } finally {
      setEditing(false)
    }
  }

  const handleActivate = async (version: ConfigVersion) => {
    setActivating(version.sk)
    setError('')
    try {
      await iacAgentApi.activateConfigVersion(activeTab, version.sk)
      await fetchVersions()
    } catch (err) {
      setError(extractApiError(err, 'Failed to activate version'))
    } finally {
      setActivating('')
    }
  }

  const handleDelete = async () => {
    if (!deleteVersion) return
    setDeleting(true)
    setError('')
    try {
      await iacAgentApi.deleteConfigVersion(activeTab, deleteVersion.sk)
      setDeleteVersion(null)
      await fetchVersions()
    } catch (err) {
      setError(extractApiError(err, 'Failed to delete version'))
    } finally {
      setDeleting(false)
    }
  }

  const handleFileUpload = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result
      if (typeof content === 'string') {
        setUploadContent(content)
      } else {
        setError('Failed to read file')
      }
    }
    reader.onerror = () => {
      setError('Failed to read file')
    }
    reader.readAsText(file)
  }

  const onlyOneVersion = versions.length <= 1

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <Button
              variant="normal"
              onClick={handleTestConfig}
              disabled={!hasSelectedDrafts}
            >
              Test Configuration
            </Button>
          }
        >
          Agent Settings
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError('')}>
            {error}
          </Alert>
        )}

        <Tabs
          activeTabId={activeTab}
          onChange={({ detail }) => {
            setActiveTab(detail.activeTabId as ConfigType)
            setExpandedVersion(null)
          }}
          tabs={TAB_CONFIG.map((tab) => ({
            id: tab.id,
            label: tab.label,
            content: (
              <SpaceBetween size="l">
                <Table
                  header={
                    <Header
                      actions={
                        <Button variant="primary" onClick={() => setShowUpload(true)}>
                          Upload New Version
                        </Button>
                      }
                    >
                      {tab.label} Versions
                    </Header>
                  }
                  loading={loading}
                  items={versions}
                  columnDefinitions={[
                    {
                      id: 'select',
                      header: 'Test',
                      cell: (item: ConfigVersion) =>
                        item.status === 'draft' ? (
                          <input
                            type="checkbox"
                            checked={selectedDrafts[activeTab] === item.sk}
                            onChange={() => toggleDraftSelection(item)}
                          />
                        ) : null,
                      width: 60,
                    },
                    {
                      id: 'version',
                      header: 'Version',
                      cell: (item: ConfigVersion) => item.sk,
                      sortingField: 'version',
                    },
                    {
                      id: 'status',
                      header: 'Status',
                      cell: (item: ConfigVersion) => statusBadge(item.status),
                    },
                    {
                      id: 'created_by',
                      header: 'Uploaded By',
                      cell: (item: ConfigVersion) => item.created_by,
                    },
                    {
                      id: 'date',
                      header: 'Date',
                      cell: (item: ConfigVersion) =>
                        new Date(item.updated_at || item.created_at).toLocaleDateString(),
                    },
                    {
                      id: 'description',
                      header: 'Description',
                      cell: (item: ConfigVersion) => item.description || '—',
                    },
                    {
                      id: 'actions',
                      header: 'Actions',
                      cell: (item: ConfigVersion) => (
                        <SpaceBetween direction="horizontal" size="xs">
                          <Button
                            variant="inline-link"
                            onClick={() =>
                              setExpandedVersion(
                                expandedVersion === item.sk ? null : item.sk
                              )
                            }
                          >
                            {expandedVersion === item.sk ? 'Hide' : 'View'}
                          </Button>
                          {item.status === 'draft' && (
                            <Button
                              variant="inline-link"
                              onClick={() => {
                                setEditVersion(item)
                                setEditContent(item.content)
                                setEditDescription(item.description)
                              }}
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            variant="inline-link"
                            disabled={item.status === 'active'}
                            loading={activating === item.sk}
                            onClick={() => handleActivate(item)}
                          >
                            Activate
                          </Button>
                          <Button
                            variant="inline-link"
                            disabled={item.status === 'active' || onlyOneVersion}
                            onClick={() => setDeleteVersion(item)}
                          >
                            Delete
                          </Button>
                        </SpaceBetween>
                      ),
                    },
                  ]}
                  empty={
                    <Box textAlign="center" color="text-body-secondary" padding="l">
                      No versions found. Upload the first version to get started.
                    </Box>
                  }
                />

                {expandedVersion && (
                  <ExpandableSection
                    headerText={`Content — ${expandedVersion}`}
                    defaultExpanded
                  >
                    <Textarea
                      value={
                        versions.find((v) => v.sk === expandedVersion)?.content ?? ''
                      }
                      readOnly
                      rows={20}
                    />
                  </ExpandableSection>
                )}
              </SpaceBetween>
            ),
          }))}
        />

        {/* Upload Modal */}
        <Modal
          visible={showUpload}
          onDismiss={() => setShowUpload(false)}
          header="Upload New Version"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setShowUpload(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={handleUpload}
                  loading={uploading}
                  disabled={!uploadContent.trim()}
                >
                  Upload
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="l">
            <FormField
              label={activeTab === 'brics_workflow' ? 'Upload YAML file' : 'Upload text file'}
              description={activeTab === 'brics_workflow' ? 'Accepts .yml and .yaml files' : 'Accepts .txt files'}
            >
              <input
                type="file"
                accept={activeTab === 'brics_workflow' ? '.yml,.yaml' : '.txt'}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFileUpload(file)
                }}
              />
            </FormField>
            <FormField label="Content">
              <Textarea
                value={uploadContent}
                onChange={({ detail }) => setUploadContent(detail.value)}
                rows={15}
                placeholder={
                  activeTab === 'system_prompt'
                    ? 'Paste the system prompt text here...'
                    : 'Paste the BRICS workflow YAML here or upload a file above...'
                }
              />
            </FormField>
            <FormField label="Description" description="What changed in this version">
              <Input
                value={uploadDescription}
                onChange={({ detail }) => setUploadDescription(detail.value)}
                placeholder="e.g., Updated BRICS directory structure rules"
              />
            </FormField>
          </SpaceBetween>
        </Modal>

        {/* Edit Modal */}
        <Modal
          visible={editVersion !== null}
          onDismiss={() => setEditVersion(null)}
          header={`Edit Draft — ${editVersion?.sk}`}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setEditVersion(null)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={handleEdit}
                  loading={editing}
                  disabled={!editContent.trim()}
                >
                  Save
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="l">
            <FormField label="Content">
              <Textarea
                value={editContent}
                onChange={({ detail }) => setEditContent(detail.value)}
                rows={15}
              />
            </FormField>
            <FormField label="Description">
              <Input
                value={editDescription}
                onChange={({ detail }) => setEditDescription(detail.value)}
              />
            </FormField>
          </SpaceBetween>
        </Modal>

        {/* Delete Confirmation */}
        <Modal
          visible={deleteVersion !== null}
          onDismiss={() => setDeleteVersion(null)}
          header="Delete Version"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setDeleteVersion(null)}>Cancel</Button>
                <Button variant="primary" onClick={handleDelete} loading={deleting}>
                  Delete
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          Are you sure you want to delete version {deleteVersion?.sk}? This action cannot be
          undone.
        </Modal>
      </SpaceBetween>
    </ContentLayout>
  )
}
