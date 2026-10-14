import { useState, useEffect } from 'react'
import { ContentLayout, Container, Header, SpaceBetween, FormField, Select, SelectProps, Button, Table, Box, Badge, Alert, FileUpload, TableProps, Modal, ColumnLayout, TextFilter, ExpandableSection } from '@cloudscape-design/components'
import apiClient from '../services/api'

interface Note {
  file_key: string
  filename: string
  size: number
  last_modified: string
  note_type: string
  application_name: string
  os_type?: string
  processing_status?: string
  processing_task_id?: string
  conflicts_count?: number
  stored_count?: number
  marked_count?: number
  total_records?: number
}

interface Conflict {
  component_id: string
  publisher: string
  product_key: string
  full_version: string
  conflict_type: string
  existing: any
  new: any
  differences: Record<string, { existing: string; new: string }>
}

const NOTE_TYPES = ['Approved Target Version', 'Default OS components', 'Application Metadata', 'Application Insights', 'ATX Common Guidelines']
const OS_TYPES = ['Rocky Linux', 'Ubuntu', 'HP-UX', 'AIX', 'Solaris', 'Red Hat Enterprise Linux', 'CentOS']
const NOTE_TYPE_FILE_EXTENSIONS: Record<string, string[]> = {
  'Approved Target Version': ['csv'],
  'Default OS components': ['txt', 'md'],
  'Application Metadata': ['json'],
  'Application Insights': ['txt', 'md'],
  'ATX Common Guidelines': ['txt', 'md']
}

export default function NotesPage() {
  const [noteType, setNoteType] = useState<SelectProps.Option | null>(null)
  const [applicationName, setApplicationName] = useState<SelectProps.Option | null>({ label: 'ALL', value: 'ALL' })
  const [osType, setOsType] = useState<SelectProps.Option | null>(null)
  const [selectedFile, setSelectedFile] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(false)
  const [applications, setApplications] = useState<{name: string, id: string}[]>([])
  const [selectedItems, setSelectedItems] = useState<Note[]>([])
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [showConflictsModal, setShowConflictsModal] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterNoteType, setFilterNoteType] = useState<SelectProps.Option | null>(null)
  const [filterApp, setFilterApp] = useState<SelectProps.Option | null>(null)

  const getAcceptedFileTypes = () => {
    if (!noteType?.value) return '.txt,.md,.csv'
    const extensions = NOTE_TYPE_FILE_EXTENSIONS[noteType.value as string] || []
    return extensions.map(ext => `.${ext}`).join(',')
  }
  const getConstraintText = () => {
    if (!noteType?.value) return 'Select a note type first'
    const extensions = NOTE_TYPE_FILE_EXTENSIONS[noteType.value as string] || []
    return `Supported formats: ${extensions.map(ext => `.${ext}`).join(', ')}`
  }

  useEffect(() => { loadApplications(); loadNotes() }, [])

  const loadApplications = async () => {
    try {
      const response = await apiClient.get('/wave/applications?summary=false')
      if (response.data.success) {
        const apps = response.data.data.applications.map((app: any) => ({ name: app.application_name, id: app.application_id }))
        const unique = apps.filter((a: any, i: number, arr: any[]) => arr.findIndex((b: any) => b.name === a.name) === i)
        setApplications(unique.sort((a: any, b: any) => a.name.localeCompare(b.name)))
      }
    } catch (error) { console.error('Error loading applications:', error) }
  }

  const loadNotes = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/notes/list')
      if (response.data.success) setNotes(response.data.notes)
    } catch (error) { console.error('Error loading notes:', error) }
    finally { setLoading(false) }
  }

  const handleUpload = async () => {
    if (!noteType || selectedFile.length === 0) { setUploadError('Please select note type and file'); return }
    if (noteType.value === 'Default OS components' && !osType) { setUploadError('Please select OS type for Default OS components'); return }
    setUploading(true); setUploadError(null); setUploadSuccess(false); setConflicts([])
    try {
      const formData = new FormData()
      formData.append('file', selectedFile[0])
      formData.append('note_type', noteType.value!)
      formData.append('application_name', applicationName?.value || 'ALL')
      const appId = applicationName?.description || ''
      if (appId) formData.append('application_id', appId)
      if (noteType.value === 'Default OS components' && osType) formData.append('os_type', osType.value!)
      const response = await apiClient.post('/notes/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (response.data.success) { setUploadSuccess(true); setSelectedFile([]); setNoteType(null); setOsType(null); loadNotes() }
    } catch (error: any) { setUploadError(error.response?.data?.error || 'Upload failed') }
    finally { setUploading(false) }
  }

  const handleDownload = async (note: Note) => {
    try {
      const response = await apiClient.get(`/notes/download/${encodeURIComponent(note.file_key)}`)
      if (response.data.url || response.data.download_url) window.open(response.data.url || response.data.download_url, '_blank')
    } catch (error) { console.error('Error downloading note:', error) }
  }

  const handleDeleteClick = (note?: Note) => { setNoteToDelete(note || null); setShowDeleteModal(true) }

  const handleDeleteConfirm = async () => {
    try {
      if (noteToDelete) { await apiClient.delete(`/notes/delete/${encodeURIComponent(noteToDelete.file_key)}`) }
      else if (selectedItems.length > 0) { await Promise.all(selectedItems.map(n => apiClient.delete(`/notes/delete/${encodeURIComponent(n.file_key)}`))); setSelectedItems([]) }
      setShowDeleteModal(false); setNoteToDelete(null); loadNotes()
    } catch (error) { console.error('Error deleting note:', error) }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  const formatDate = (dateString: string) => new Date(dateString).toLocaleString()

  const handleViewConflicts = async (note: Note) => {
    if (!note.processing_task_id) return
    try {
      const response = await apiClient.get(`/notes/processing-status/${note.processing_task_id}`)
      if (response.data.success && response.data.task.conflicts) { setConflicts(response.data.task.conflicts); setShowConflictsModal(true) }
    } catch (error) { console.error('Error loading conflicts:', error) }
  }

  const getStatusBadge = (status?: string) => {
    if (!status) return null
    const cfg: Record<string, { color: 'blue' | 'green' | 'red' | 'grey', label: string }> = {
      pending: { color: 'grey', label: 'Pending' }, processing: { color: 'blue', label: 'Processing' },
      completed: { color: 'green', label: 'Active' }, failed: { color: 'red', label: 'Failed' }, active: { color: 'green', label: 'Active' }
    }
    const c = cfg[status] || { color: 'grey' as const, label: status }
    return <Badge color={c.color}>{c.label}</Badge>
  }

  // Filter notes
  const filteredNotes = notes.filter(n => {
    if (searchText && !n.filename.toLowerCase().includes(searchText.toLowerCase())) return false
    if (filterNoteType?.value && n.note_type !== filterNoteType.value) return false
    if (filterApp?.value && n.application_name !== filterApp.value && !n.file_key.includes(`/${filterApp.value}/`)) return false
    return true
  })

  // Group by application name
  const grouped: Record<string, Note[]> = {}
  for (const note of filteredNotes) {
    const key = note.application_name || 'ALL'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(note)
  }
  const appNames = Object.keys(grouped).sort((a, b) => {
    if (a === 'ALL') return -1
    if (b === 'ALL') return 1
    return a.localeCompare(b)
  })

  const noteColumns: TableProps.ColumnDefinition<Note>[] = [
    { id: 'filename', header: 'Filename', cell: i => i.filename, width: 250 },
    { id: 'note_type', header: 'Note Type', cell: i => <Badge color="blue">{i.note_type}</Badge>, width: 180 },
    { id: 'os_type', header: 'OS Type', cell: i => i.os_type || '-', width: 120 },
    { id: 'status', header: 'Status', cell: i => getStatusBadge(i.processing_status), width: 100 },
    { id: 'stats', header: 'Stats', cell: i => {
      if (i.note_type === 'Default OS components' && i.processing_status === 'completed')
        return <Box>{i.stored_count !== undefined && <Box>Stored: {i.stored_count}</Box>}{i.marked_count !== undefined && <Box>Noise: {i.marked_count}</Box>}</Box>
      if (i.processing_status === 'active') return 'Stored: S3'
      if (i.stored_count != null) return `Stored: ${i.stored_count}`
      return '-'
    }, width: 140 },
    { id: 'size', header: 'Size', cell: i => formatFileSize(i.size), width: 80 },
    { id: 'uploaded', header: 'Uploaded', cell: i => formatDate(i.last_modified), width: 170 },
    { id: 'actions', header: 'Actions', cell: i => (
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant="inline-link" onClick={() => handleDownload(i)}>Download</Button>
        <Button variant="inline-link" onClick={() => handleDeleteClick(i)}>Delete</Button>
        {i.conflicts_count && i.conflicts_count > 0 ? <Button variant="inline-link" onClick={() => handleViewConflicts(i)}>Conflicts ({i.conflicts_count})</Button> : null}
      </SpaceBetween>
    ), width: 250 },
  ]

  return (
    <ContentLayout header={<Header variant="h1" description="Upload and manage notes for applications">Notes Management</Header>}>
      <SpaceBetween size="l">
        {/* Upload section */}
        <Container header={<Header variant="h2">Upload Note</Header>}>
          <SpaceBetween size="m">
            {uploadSuccess && <Alert type="success" dismissible onDismiss={() => setUploadSuccess(false)}>File uploaded successfully!</Alert>}
            {uploadError && <Alert type="error" dismissible onDismiss={() => setUploadError(null)}>{uploadError}</Alert>}
            <ColumnLayout columns={noteType?.value === 'Default OS components' ? 3 : 2}>
              <FormField label="Note Type" description="Select the type of note">
                <Select selectedOption={noteType} onChange={(e: any) => {
                  setNoteType(e.detail.selectedOption)
                  if (e.detail.selectedOption?.value !== 'Default OS components') setOsType(null)
                  if (['ATX Common Guidelines', 'Application Metadata', 'Approved Target Version'].includes(e.detail.selectedOption?.value)) setApplicationName({ label: 'ALL', value: 'ALL' })
                }} options={NOTE_TYPES.map(t => ({ label: t, value: t }))} placeholder="Select note type" disabled={uploading} />
              </FormField>
              <FormField label="Application Name" description="Select application or ALL">
                <Select selectedOption={applicationName} onChange={(e: any) => setApplicationName(e.detail.selectedOption)}
                  options={[{ label: 'ALL', value: 'ALL', description: '' }, ...applications.map(a => ({ label: a.name, value: a.name, description: a.id }))]}
                  placeholder="Select application" filteringType="auto"
                  disabled={uploading || ['ATX Common Guidelines', 'Application Metadata', 'Approved Target Version'].includes(noteType?.value || '')} />
              </FormField>
              {noteType?.value === 'Default OS components' && (
                <FormField label="OS Type" description="Select the operating system type">
                  <Select selectedOption={osType} onChange={(e: any) => setOsType(e.detail.selectedOption)}
                    options={OS_TYPES.map(t => ({ label: t, value: t }))} placeholder="Select OS type" disabled={uploading} />
                </FormField>
              )}
            </ColumnLayout>
            <FormField label="Upload File" constraintText={getConstraintText()}>
              <FileUpload value={selectedFile} onChange={(e: any) => setSelectedFile(e.detail.value)} accept={getAcceptedFileTypes()} showFileSize showFileLastModified
                i18nStrings={{ uploadButtonText: (m: any) => m ? 'Choose files' : 'Choose file', dropzoneText: (m: any) => m ? 'Drop files' : 'Drop file',
                  removeFileAriaLabel: (i: any) => `Remove file ${i + 1}`, limitShowFewer: 'Show fewer', limitShowMore: 'Show more', errorIconAriaLabel: 'Error' }} />
            </FormField>
            <Button variant="primary" onClick={handleUpload} disabled={!noteType || selectedFile.length === 0 || uploading || (noteType?.value === 'Default OS components' && !osType)} loading={uploading}>Upload</Button>
          </SpaceBetween>
        </Container>

        {/* Notes grouped by application */}
        <Container header={<Header variant="h2" counter={`(${filteredNotes.length})`} actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="remove" onClick={() => handleDeleteClick()} disabled={selectedItems.length === 0}>Delete ({selectedItems.length})</Button>
            <Button iconName="refresh" onClick={loadNotes} loading={loading}>Refresh</Button>
          </SpaceBetween>
        }>Uploaded Notes</Header>}>
          <SpaceBetween size="s">
            <SpaceBetween direction="horizontal" size="s">
              <TextFilter filteringText={searchText} onChange={({ detail }) => setSearchText(detail.filteringText)} filteringPlaceholder="Search by filename" />
              <Select selectedOption={filterNoteType} onChange={({ detail }) => setFilterNoteType(detail.selectedOption)}
                options={[{ label: 'All Types', value: '' }, ...NOTE_TYPES.map(t => ({ label: t, value: t }))]} placeholder="Note Type" />
              <Select selectedOption={filterApp} onChange={({ detail }) => setFilterApp(detail.selectedOption)}
                options={[{ label: 'All Apps', value: '' }, ...applications.map(a => ({ label: `${a.name} (${a.id})`, value: a.id }))]} placeholder="Application" filteringType="auto" />
            </SpaceBetween>
            {loading && <Box textAlign="center">Loading...</Box>}
            {!loading && appNames.length === 0 && <Box textAlign="center" padding="l">No notes found. Upload a note to get started.</Box>}
            {appNames.map(appName => (
              <ExpandableSection key={appName} defaultExpanded={false}
                headerText={`${appName === 'ALL' ? 'Global (ALL)' : appName} — ${grouped[appName].length} file${grouped[appName].length !== 1 ? 's' : ''}`}>
                <Table columnDefinitions={noteColumns} items={grouped[appName]} variant="embedded" wrapLines={false} stripedRows
                  selectionType="multi" trackBy="file_key"
                  selectedItems={selectedItems.filter(si => grouped[appName].some(n => n.file_key === si.file_key))}
                  onSelectionChange={(e: any) => {
                    const keys = new Set(grouped[appName].map(n => n.file_key))
                    const others = selectedItems.filter(si => !keys.has(si.file_key))
                    setSelectedItems([...others, ...e.detail.selectedItems])
                  }}
                  empty={<Box textAlign="center">No files</Box>} />
              </ExpandableSection>
            ))}
          </SpaceBetween>
        </Container>
      </SpaceBetween>

      {/* Delete modal */}
      <Modal visible={showDeleteModal} onDismiss={() => setShowDeleteModal(false)} header="Delete Note"
        footer={<Box float="right"><SpaceBetween direction="horizontal" size="xs">
          <Button variant="link" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleDeleteConfirm}>Delete</Button>
        </SpaceBetween></Box>}>
        <Box>{noteToDelete ? `Delete ${noteToDelete.filename}?` : `Delete ${selectedItems.length} selected note(s)?`} This cannot be undone.</Box>
      </Modal>

      {/* Conflicts modal */}
      <Modal visible={showConflictsModal} onDismiss={() => setShowConflictsModal(false)} header={`Conflicts (${conflicts.length})`} size="large"
        footer={<Box float="right"><Button variant="primary" onClick={() => setShowConflictsModal(false)}>Close</Button></Box>}>
        <SpaceBetween size="m">
          <Alert type="warning">These components already exist with different values and were not updated.</Alert>
          {conflicts.map((c, i) => (
            <Container key={i} header={<Header variant="h3">{c.publisher} - {c.product_key} {c.full_version}</Header>}>
              <ColumnLayout columns={2}>
                <SpaceBetween size="s">
                  <Box variant="h4">Existing</Box>
                  {Object.entries(c.differences).map(([f, v]) => <Box key={f}><Box variant="awsui-key-label">{f.replace(/_/g, ' ')}</Box><Box>{v.existing || '(empty)'}</Box></Box>)}
                </SpaceBetween>
                <SpaceBetween size="s">
                  <Box variant="h4">New (Not Applied)</Box>
                  {Object.entries(c.differences).map(([f, v]) => <Box key={f}><Box variant="awsui-key-label">{f.replace(/_/g, ' ')}</Box><Box>{v.new || '(empty)'}</Box></Box>)}
                </SpaceBetween>
              </ColumnLayout>
            </Container>
          ))}
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  )
}
