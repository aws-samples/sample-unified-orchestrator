import { useEffect, useMemo, useState } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Textarea,
  Box,
  Spinner,
  Alert,
  StatusIndicator,
  FormField,
  Select,
  Icon,
} from '@cloudscape-design/components'
import TreeView from '@cloudscape-design/components/tree-view'
import { extractApiError } from '../../utils/extractApiError'
import type { SelectProps } from '@cloudscape-design/components'
import Editor from '@monaco-editor/react'
import { iacAgentApi, type SessionFiles } from '../../services/iacAgent'

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string
  name: string
  path: string          // full relative path for files, empty for dirs
  isFile: boolean
  children: TreeNode[]
}

/** Build a tree from flat relative-path keys. */
function buildTree(filePaths: string[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const filePath of filePaths.sort()) {
    const parts = filePath.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const id = parts.slice(0, i + 1).join('/')

      let existing = current.find((n) => n.name === part && n.isFile === isFile)
      if (!existing) {
        existing = { id, name: part, path: isFile ? filePath : '', isFile, children: [] }
        current.push(existing)
      }
      current = existing.children
    }
  }

  return root
}

/** Detect Monaco language from file extension. */
function languageFor(path: string): string {
  if (path.endsWith('.tf') || path.endsWith('.tfvars')) return 'hcl'
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.sh')) return 'shell'
  if (path.endsWith('.py')) return 'python'
  return 'plaintext'
}

export function buildVersionOptionsFromList(
  versions: string[],
  currentVersion: string,
  approvedVersion: string | null,
): SelectProps.Option[] {
  return versions.map((v) => {
    const isApproved = v === approvedVersion
    const isCurrent = v === currentVersion
    return {
      label: isApproved ? `${v.toUpperCase()} ✓` : v.toUpperCase(),
      value: v,
      description: isApproved ? 'Approved' : isCurrent ? 'Current' : undefined,
    }
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CodeReviewPanelProps {
  sessionId: string
  currentVersion: string
  versions: string[]
  approvedVersion: string | null
  onApproved: () => void
  onFeedbackSubmitted?: () => void
  readOnly?: boolean
  onCancel?: () => void
  cancelLoading?: boolean
}

export default function CodeReviewPanel({
  sessionId,
  currentVersion,
  versions,
  approvedVersion,
  onApproved,
  onFeedbackSubmitted,
  readOnly,
  onCancel,
  cancelLoading,
}: CodeReviewPanelProps) {
  const [files, setFiles] = useState<SessionFiles>({})
  const [version, setVersion] = useState(currentVersion)
  const [loading, setLoading] = useState(true)
  const [feedbackText, setFeedbackText] = useState('')
  const [submittingFeedback, setSubmittingFeedback] = useState(false)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const effectiveVersions = versions.length > 0 ? versions : [currentVersion]
  const versionOptions = buildVersionOptionsFromList(effectiveVersions, currentVersion, approvedVersion)
  const selectedVersionOption = versionOptions.find((o) => o.value === version) ?? null

  // Build tree from file paths
  const treeItems = useMemo(() => buildTree(Object.keys(files)), [files])

  const fetchFiles = async (v: string) => {
    setLoading(true)
    try {
      const { data } = await iacAgentApi.getSessionFiles(sessionId, v)
      setFiles(data)
      const paths = Object.keys(data).sort()
      if (paths.length > 0 && !selectedFile) {
        setSelectedFile(paths[0])
      }
      setError(null)
    } catch {
      setError('Failed to load generated files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles(currentVersion)
  }, [sessionId, currentVersion])

  const handleFeedback = async () => {
    if (!feedbackText.trim()) return
    setSubmittingFeedback(true)
    setError(null)
    try {
      await iacAgentApi.submitFeedback(sessionId, feedbackText.trim())
      setFeedbackText('')
      // Feedback is now async — transition to generating state via callback
      if (onFeedbackSubmitted) onFeedbackSubmitted()
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to submit feedback'))
    } finally {
      setSubmittingFeedback(false)
    }
  }

  const handleApprove = async () => {
    setApproving(true)
    setError(null)
    try {
      await iacAgentApi.approve(sessionId)
      onApproved()
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const resp = (err as { response?: { status?: number } }).response
        if (resp?.status === 409) {
          setError('This session has already been approved.')
          return
        }
      }
      setError(extractApiError(err, 'Failed to approve'))
    } finally {
      setApproving(false)
    }
  }

  const filePaths = Object.keys(files).sort()

  return (
    <SpaceBetween size="l">
      {error && <Alert type="error" dismissible onDismiss={() => setError(null)}>{error}</Alert>}

      <Container
        header={
          <Header
            variant="h2"
            description={
              readOnly
                ? (version === approvedVersion
                    ? <StatusIndicator type="success">Approved</StatusIndicator>
                    : <StatusIndicator type="warning">Viewing non-approved version</StatusIndicator>)
                : `Reviewing generated code — ${version}`
            }
            actions={
              <SpaceBetween size="s" direction="horizontal">
                {versionOptions.length > 1 && (
                  <Select
                    selectedOption={selectedVersionOption}
                    onChange={({ detail }) => {
                      setVersion(detail.selectedOption.value!)
                      setSelectedFile(null)
                      fetchFiles(detail.selectedOption.value!)
                    }}
                    options={versionOptions}
                  />
                )}
                {!readOnly && (
                  <Button
                    onClick={handleApprove}
                    loading={approving}
                    variant="primary"
                    disabled={version !== currentVersion || submittingFeedback}
                  >
                    Approve
                  </Button>
                )}
                {!readOnly && onCancel && (
                  <Button
                    onClick={onCancel}
                    loading={cancelLoading}
                    variant="normal"
                    disabled={cancelLoading}
                  >
                    Cancel Generation
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            Code Review
          </Header>
        }
      >
        {loading ? (
          <Box textAlign="center" padding="xl"><Spinner size="large" /></Box>
        ) : filePaths.length === 0 ? (
          <Alert type="info">No generated files found for this version.</Alert>
        ) : (
          <div style={{
            display: 'flex',
            minHeight: '600px',
            border: '1px solid #414d5c',
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: '#1e1e1e',
          }}>
            {/* File Tree Sidebar */}
            <div style={{
              width: '280px',
              borderRight: '1px solid #414d5c',
              backgroundColor: '#252526',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#1e1e1e',
                borderBottom: '1px solid #414d5c',
              }}>
                <span style={{
                  color: '#cccccc',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  Explorer
                </span>
              </div>
              <div style={{ padding: '4px 0', flex: 1 }}>
                <TreeView<TreeNode>
                  items={treeItems}
                  getItemId={(item) => item.id}
                  getItemChildren={(item) => item.children}
                  renderItem={(item) => ({
                    content: (
                      <span
                        onClick={() => {
                          if (item.isFile) setSelectedFile(item.path)
                        }}
                        style={{
                          cursor: item.isFile ? 'pointer' : 'default',
                          color: selectedFile === item.path ? '#ffffff' : '#cccccc',
                          fontWeight: selectedFile === item.path ? 500 : 400,
                          fontSize: '13px',
                        }}
                      >
                        {item.name}
                      </span>
                    ),
                    icon: item.isFile
                      ? <Icon name="file" />
                      : <Icon name="folder" />,
                  })}
                  connectorLines="vertical"
                  ariaLabel="Generated files"
                />
              </div>
            </div>

            {/* Editor Panel */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#ffffff' }}>
              {selectedFile ? (
                <>
                  {/* Single file tab header */}
                  <div style={{
                    padding: '8px 16px',
                    backgroundColor: '#1e1e1e',
                    borderBottom: '1px solid #414d5c',
                    color: '#cccccc',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <Icon name="file" />
                    <span style={{ color: '#808080' }}>
                      {selectedFile.split('/').slice(0, -1).join(' / ')}
                      {selectedFile.includes('/') ? ' / ' : ''}
                    </span>
                    <span style={{ color: '#ffffff', fontWeight: 500 }}>
                      {selectedFile.split('/').pop()}
                    </span>
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <Editor
                      height="100%"
                      language={languageFor(selectedFile)}
                      theme="vs-dark"
                      value={files[selectedFile] ?? ''}
                      options={{
                        readOnly: true,
                        minimap: { enabled: true },
                        fontSize: 14,
                        lineNumbers: 'on',
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        wordWrap: 'off',
                        folding: true,
                        renderWhitespace: 'selection',
                        scrollbar: {
                          vertical: 'visible',
                          horizontal: 'visible',
                          useShadows: false,
                          verticalScrollbarSize: 10,
                          horizontalScrollbarSize: 10,
                        },
                      }}
                      loading={
                        <Box textAlign="center" padding="xl">
                          <Spinner size="large" />
                        </Box>
                      }
                    />
                  </div>
                </>
              ) : (
                <Box textAlign="center" padding="xl" color="text-body-secondary">
                  Select a file to view
                </Box>
              )}
            </div>
          </div>
        )}
      </Container>

      {/* Feedback Section */}
      {!readOnly && (
      <Container header={<Header variant="h3">Feedback</Header>}>
        <SpaceBetween size="s">
          <FormField
            label="Describe changes"
            description="Provide feedback to regenerate improved code"
          >
            <Textarea
              value={feedbackText}
              onChange={({ detail }) => setFeedbackText(detail.value)}
              placeholder="Example: Add tags for compliance, change instance type to t3.large..."
              rows={4}
            />
          </FormField>
          <Box>
            <Button
              onClick={handleFeedback}
              loading={submittingFeedback}
              disabled={!feedbackText.trim() || version !== currentVersion}
            >
              Submit Feedback &amp; Regenerate
            </Button>
            {submittingFeedback && (
              <Box variant="small" margin={{ left: 's' }} display="inline">
                <StatusIndicator type="in-progress">Regenerating code...</StatusIndicator>
              </Box>
            )}
          </Box>
        </SpaceBetween>
      </Container>
      )}
    </SpaceBetween>
  )
}
