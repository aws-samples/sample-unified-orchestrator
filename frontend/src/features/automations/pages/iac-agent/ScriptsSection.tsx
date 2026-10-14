import { useEffect, useRef, useState } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  Box,
  Alert,
  Checkbox,
} from '@cloudscape-design/components'
import { iacAgentApi } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'

const MAX_SCRIPT_SIZE = 64 * 1024 // 64 KB

interface ScriptsSectionProps {
  motsId: string
  environment: string
  instanceName: string
  blueprintName: string
  hasUserData: boolean
  hasPostDeployScript: boolean
  /** Filename from the previous instance (enables "use same" checkbox) */
  previousUserDataFilename?: string | null
  previousPostDeployFilename?: string | null
  onScriptUploaded: (scriptType: string, filename: string) => void
  onScriptRemoved: (scriptType: string) => void
}

interface ScriptState {
  filename: string | null
  uploading: boolean
  useSameAsPrevious: boolean
}

export default function ScriptsSection({
  motsId,
  environment,
  instanceName,
  blueprintName,
  hasUserData,
  hasPostDeployScript,
  previousUserDataFilename,
  previousPostDeployFilename,
  onScriptUploaded,
  onScriptRemoved,
}: ScriptsSectionProps) {
  const [userDataScript, setUserDataScript] = useState<ScriptState>({ filename: null, uploading: false, useSameAsPrevious: false })
  const [postDeployScript, setPostDeployScript] = useState<ScriptState>({ filename: null, uploading: false, useSameAsPrevious: false })
  const [error, setError] = useState<string | null>(null)

  const userDataInputRef = useRef<HTMLInputElement>(null)
  const postDeployInputRef = useRef<HTMLInputElement>(null)

  // Auto-check "use same as above" when a previous filename becomes available
  useEffect(() => {
    if (previousUserDataFilename && hasUserData && !userDataScript.filename && !userDataScript.useSameAsPrevious) {
      setUserDataScript({ filename: previousUserDataFilename, uploading: false, useSameAsPrevious: true })
      onScriptUploaded('user_data', previousUserDataFilename)
    }
  }, [previousUserDataFilename]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (previousPostDeployFilename && hasPostDeployScript && !postDeployScript.filename && !postDeployScript.useSameAsPrevious) {
      setPostDeployScript({ filename: previousPostDeployFilename, uploading: false, useSameAsPrevious: true })
      onScriptUploaded('post_deploy_script', previousPostDeployFilename)
    }
  }, [previousPostDeployFilename]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (file: File, scriptType: string) => {
    setError(null)

    if (!file.name.endsWith('.sh')) {
      setError('File must have a .sh extension')
      return
    }
    if (file.size > MAX_SCRIPT_SIZE) {
      setError('File size exceeds the 64 KB limit')
      return
    }

    const setter = scriptType === 'user_data' ? setUserDataScript : setPostDeployScript
    setter({ filename: null, uploading: true, useSameAsPrevious: false })

    try {
      await iacAgentApi.uploadScript(motsId, environment, scriptType, file)
      setter({ filename: file.name, uploading: false, useSameAsPrevious: false })
      onScriptUploaded(scriptType, file.name)
    } catch (err: unknown) {
      setter({ filename: null, uploading: false, useSameAsPrevious: false })
      setError(extractApiError(err, `Failed to upload ${scriptType} script`))
    }
  }

  const handleRemove = (scriptType: string) => {
    const setter = scriptType === 'user_data' ? setUserDataScript : setPostDeployScript
    setter({ filename: null, uploading: false, useSameAsPrevious: false })
    onScriptRemoved(scriptType)
  }

  const handleUseSame = (scriptType: string, checked: boolean, previousFilename: string) => {
    const setter = scriptType === 'user_data' ? setUserDataScript : setPostDeployScript
    if (checked) {
      setter({ filename: previousFilename, uploading: false, useSameAsPrevious: true })
      onScriptUploaded(scriptType, previousFilename)
    } else {
      setter({ filename: null, uploading: false, useSameAsPrevious: false })
      onScriptRemoved(scriptType)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, scriptType: string) => {
    const file = event.target.files?.[0]
    if (file) handleUpload(file, scriptType)
    event.target.value = ''
  }

  const scriptDescriptions: Record<string, string> = {
    user_data: 'Shell or cloud-init script executed on first boot before SSM-based configuration.',
    post_deploy_script: 'Shell script executed after EBS volumes are mounted and deployment is complete.',
  }

  const renderScriptRow = (
    label: string,
    scriptType: string,
    state: ScriptState,
    inputRef: React.RefObject<HTMLInputElement>,
    previousFilename?: string | null,
  ) => (
    <SpaceBetween size="xs" key={scriptType}>
      <Box variant="small" color="text-body-secondary">{scriptDescriptions[scriptType]}</Box>
      <SpaceBetween direction="horizontal" size="s">
        <Box variant="p" fontWeight="bold">{label}:</Box>
        <input
          ref={inputRef}
          type="file"
          accept=".sh"
          style={{ display: 'none' }}
          onChange={(e) => handleFileChange(e, scriptType)}
        />
        {state.useSameAsPrevious ? (
          <Box variant="p">{state.filename} (same as above)</Box>
        ) : state.filename ? (
          <>
            <Box variant="p">{state.filename}</Box>
            <Button variant="inline-link" onClick={() => handleRemove(scriptType)}>Remove</Button>
          </>
        ) : (
          <Button
            iconName="upload"
            loading={state.uploading}
            onClick={() => inputRef.current?.click()}
          >
            Upload
          </Button>
        )}
      </SpaceBetween>
      {previousFilename && (
        <Checkbox
          checked={state.useSameAsPrevious}
          onChange={({ detail }) => handleUseSame(scriptType, detail.checked, previousFilename)}
        >
          Use same script as above ({previousFilename})
        </Checkbox>
      )}
    </SpaceBetween>
  )

  return (
    <Container header={<Header variant="h3" headingTagOverride="h4">Scripts — {instanceName} ({blueprintName})</Header>}>
      <SpaceBetween size="s">
        {error && <Alert type="error" dismissible onDismiss={() => setError(null)}>{error}</Alert>}
        {hasUserData && renderScriptRow('User Data Script', 'user_data', userDataScript, userDataInputRef, previousUserDataFilename)}
        {hasPostDeployScript && renderScriptRow('Post Deploy Script', 'post_deploy_script', postDeployScript, postDeployInputRef, previousPostDeployFilename)}
      </SpaceBetween>
    </Container>
  )
}
