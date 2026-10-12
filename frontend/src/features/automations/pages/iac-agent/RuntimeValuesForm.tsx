import React, { useEffect, useState, useRef } from 'react'
import {
  Container,
  Header,
  SpaceBetween,
  Button,
  FormField,
  Input,
  Textarea,
  Box,
  Spinner,
  Alert,
  ExpandableSection,
  Toggle,
} from '@cloudscape-design/components'
import { iacAgentApi } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'
import ScriptsSection from './ScriptsSection'

interface RuntimeValuesFormProps {
  motsId: string
  environment: string
  onComplete: () => void
}

interface ParameterSchema {
  type?: string
  properties?: Record<string, { type?: string; enum?: string[]; description?: string; pattern?: string }>
  required?: string[]
}

function parseSchema(raw: unknown): ParameterSchema {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ParameterSchema } catch { return {} }
  }
  return raw as ParameterSchema
}

export default function RuntimeValuesForm({ motsId, environment, onComplete }: RuntimeValuesFormProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appCatalog, setAppCatalog] = useState<Record<string, unknown> | null>(null)
  const [blueprintSchemas, setBlueprintSchemas] = useState<Record<string, ParameterSchema>>({})
  const [values, setValues] = useState<Record<string, { instances: Record<string, string>[] }>>({})
  const [jsonMode, setJsonMode] = useState(true)
  const [rawJson, setRawJson] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Track uploaded script filenames per blueprint/instance: { "bp::idx::scriptType": filename }
  const [scriptFilenames, setScriptFilenames] = useState<Record<string, string>>({})

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size === 0) { setError('File is empty'); event.target.value = ''; return }
    if (file.size > 1024 * 1024) { setError('File too large (max 1 MB)'); event.target.value = ''; return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      try {
        JSON.parse(content) // validate
        setRawJson(content)
        setError(null)
      } catch {
        setError('Invalid JSON in file')
      }
    }
    reader.onerror = () => setError('Failed to read file')
    reader.readAsText(file)
    event.target.value = ''
  }

  useEffect(() => {
    const init = async () => {
      try {
        const { data: catalog } = await iacAgentApi.getAppCatalog(motsId)
        setAppCatalog(catalog)

        const catalogRecord = catalog as Record<string, unknown>
        const composition = catalogRecord.app_composition as {
          blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[]
        } | undefined

        if (!composition?.blueprints) {
          setError('No composition found')
          setLoading(false)
          return
        }

        const schemas: Record<string, ParameterSchema> = {}
        const initialValues: Record<string, { instances: Record<string, string>[] }> = {}

        // Check for previously saved runtime values for this environment
        const savedRuntimeValues = catalogRecord[`${environment}_runtime_values`] as
          Record<string, { instances: Record<string, string>[] }> | undefined

        for (const bp of composition.blueprints) {
          try {
            const { data: bpData } = await iacAgentApi.getBlueprint(bp.blueprint_name, bp.version)
            // Use parameters_schema first, fall back to input_schema
            const rawSchema = (bpData as unknown as Record<string, unknown>).parameters_schema
              ?? (bpData as unknown as Record<string, unknown>).input_schema
            schemas[bp.blueprint_name] = parseSchema(rawSchema)
          } catch {
            schemas[bp.blueprint_name] = {}
          }

          // Use saved values if available, otherwise start with empty instance stubs
          if (savedRuntimeValues?.[bp.blueprint_name]?.instances) {
            initialValues[bp.blueprint_name] = savedRuntimeValues[bp.blueprint_name]
          } else {
            const schema = schemas[bp.blueprint_name] ?? {}
            const requiredFields = schema.required ?? []
            const properties = schema.properties ?? {}

            initialValues[bp.blueprint_name] = {
              instances: bp.instances.map((inst) => {
                const stub: Record<string, string> = { instance_name: inst.instance_name }
                for (const field of requiredFields) {
                  if (!(field in stub)) {
                    stub[field] = properties[field]?.enum?.[0] ?? ''
                  }
                }
                return stub
              }),
            }
          }
        }

        setBlueprintSchemas(schemas)
        setValues(initialValues)
        setRawJson(JSON.stringify(initialValues, null, 2))
      } catch {
        setError('Failed to load application data')
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [motsId, environment])

  const updateValue = (bpName: string, instanceIdx: number, paramName: string, paramValue: string) => {
    setValues((prev) => {
      const updated = { ...prev }
      const bp = { ...updated[bpName] }
      const instances = [...bp.instances]
      instances[instanceIdx] = { ...instances[instanceIdx], [paramName]: paramValue }
      bp.instances = instances
      updated[bpName] = bp
      return updated
    })
  }

  const scriptKey = (bpName: string, idx: number, scriptType: string) =>
    `${bpName}::${idx}::${scriptType}`

  const handleScriptUploaded = (bpName: string, idx: number, scriptType: string, filename: string) => {
    const field = scriptType === 'user_data' ? 'user_data_path' : 'post_deploy_script_path'
    updateValue(bpName, idx, field, filename)
    setScriptFilenames((prev) => ({ ...prev, [scriptKey(bpName, idx, scriptType)]: filename }))

    // Sync script path into rawJson so JSON-mode saves include it
    if (jsonMode) {
      setRawJson((prev) => {
        try {
          const parsed = JSON.parse(prev) as Record<string, { instances: Record<string, string>[] }>
          if (parsed[bpName]?.instances?.[idx]) {
            parsed[bpName].instances[idx][field] = filename
          }
          return JSON.stringify(parsed, null, 2)
        } catch {
          return prev
        }
      })
    }
  }

  const handleScriptRemoved = (bpName: string, idx: number, scriptType: string) => {
    const field = scriptType === 'user_data' ? 'user_data_path' : 'post_deploy_script_path'
    updateValue(bpName, idx, field, '')
    setScriptFilenames((prev) => {
      const next = { ...prev }
      delete next[scriptKey(bpName, idx, scriptType)]
      return next
    })

    // Sync script path removal into rawJson
    if (jsonMode) {
      setRawJson((prev) => {
        try {
          const parsed = JSON.parse(prev) as Record<string, { instances: Record<string, string>[] }>
          if (parsed[bpName]?.instances?.[idx]) {
            delete parsed[bpName].instances[idx][field]
          }
          return JSON.stringify(parsed, null, 2)
        } catch {
          return prev
        }
      })
    }
  }

  const renderScriptsSectionForInstance = (
    bpName: string,
    instanceName: string,
    idx: number,
    hasUserData: boolean,
    hasPostDeployScript: boolean,
  ) => {
    if (!hasUserData && !hasPostDeployScript) return null
    const prevUd = idx > 0 ? scriptFilenames[scriptKey(bpName, idx - 1, 'user_data')] ?? null : null
    const prevPm = idx > 0 ? scriptFilenames[scriptKey(bpName, idx - 1, 'post_deploy_script')] ?? null : null
    return (
      <ScriptsSection
        motsId={motsId}
        environment={environment}
        instanceName={instanceName}
        blueprintName={bpName}
        hasUserData={hasUserData}
        hasPostDeployScript={hasPostDeployScript}
        previousUserDataFilename={prevUd}
        previousPostDeployFilename={prevPm}
        onScriptUploaded={(scriptType, filename) => handleScriptUploaded(bpName, idx, scriptType, filename)}
        onScriptRemoved={(scriptType) => handleScriptRemoved(bpName, idx, scriptType)}
      />
    )
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      let payload: Record<string, unknown>
      if (jsonMode) {
        try {
          payload = JSON.parse(rawJson)
        } catch {
          setError('Invalid JSON — please check your input')
          setSaving(false)
          return
        }
      } else {
        payload = values
      }
      await iacAgentApi.saveRuntimeValues(motsId, environment, { values: payload })
      onComplete()
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to save runtime values'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Container header={<Header variant="h2">Runtime Values</Header>}>
        <Box textAlign="center" padding="xl"><Spinner size="large" /></Box>
      </Container>
    )
  }

  const composition = (appCatalog as Record<string, unknown>)?.app_composition as {
    blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[]
  } | undefined

  return (
    <Container
      header={
        <Header
          variant="h2"
          description={`Enter runtime values for the "${environment}" environment. Only required keys are populated — review the blueprint schema to include any optional fields your deployment needs.`}
          actions={
            <SpaceBetween direction="horizontal" size="s">
              <Toggle checked={jsonMode} onChange={({ detail }) => {
                setJsonMode(detail.checked)
                if (detail.checked && !rawJson) {
                  setRawJson(JSON.stringify(values, null, 2))
                }
              }}>
                JSON input
              </Toggle>
              <Button variant="primary" onClick={handleSave} loading={saving}>
                Save Runtime Values
              </Button>
            </SpaceBetween>
          }
        >
          Runtime Values
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && <Alert type="error" dismissible onDismiss={() => setError(null)}>{error}</Alert>}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {jsonMode ? (
          <SpaceBetween size="l">
            <FormField
              label="Runtime values (JSON)"
              description="Paste, edit, or import a JSON file with runtime values"
              secondaryControl={
                <Button iconName="upload" onClick={() => fileInputRef.current?.click()}>
                  Import JSON
                </Button>
              }
            >
              <Textarea
                value={rawJson}
                onChange={({ detail }) => setRawJson(detail.value)}
                rows={20}
              />
            </FormField>
            {composition?.blueprints.map((bp) => {
              const schema = blueprintSchemas[bp.blueprint_name] ?? {}
              const properties = schema.properties ?? {}
              const hasUserData = 'user_data_path' in properties
              const hasPostDeployScript = 'post_deploy_script_path' in properties
              if (!hasUserData && !hasPostDeployScript) return null
              return bp.instances.map((inst, idx) =>
                <React.Fragment key={`${bp.blueprint_name}-${inst.instance_name}`}>
                  {renderScriptsSectionForInstance(bp.blueprint_name, inst.instance_name, idx, hasUserData, hasPostDeployScript)}
                </React.Fragment>
              )
            })}
          </SpaceBetween>
        ) : (
          composition?.blueprints.map((bp) => {
          const schema = blueprintSchemas[bp.blueprint_name] ?? {}
          const properties = schema.properties ?? {}
          const requiredFields = schema.required ?? []
          const paramNames = Object.keys(properties)

          return (
            <ExpandableSection
              key={bp.blueprint_name}
              headerText={`${bp.blueprint_name} (${bp.version})`}
              defaultExpanded
            >
              <SpaceBetween size="m">
                {bp.instances.map((inst, idx) => (
                  <Container key={inst.instance_name} header={<Header variant="h3">{inst.instance_name}</Header>}>
                    <SpaceBetween size="s">
                      {paramNames.map((param) => {
                        const propDef = properties[param]
                        const isRequired = requiredFields.includes(param)
                        const currentVal = values[bp.blueprint_name]?.instances[idx]?.[param] ?? ''

                        return (
                          <FormField
                            key={param}
                            label={`${param}${isRequired ? ' *' : ''}`}
                            description={propDef?.description}
                          >
                            <Input
                              value={currentVal}
                              onChange={({ detail }) => updateValue(bp.blueprint_name, idx, param, detail.value)}
                              placeholder={propDef?.enum ? propDef.enum.join(' | ') : `Enter ${param}`}
                            />
                          </FormField>
                        )
                      })}
                      {paramNames.length === 0 && (
                        <Box variant="p" color="text-body-secondary">No parameters defined for this blueprint.</Box>
                      )}
                      {(() => {
                        const hasUserData = 'user_data_path' in properties
                        const hasPostDeployScript = 'post_deploy_script_path' in properties
                        return renderScriptsSectionForInstance(bp.blueprint_name, inst.instance_name, idx, hasUserData, hasPostDeployScript)
                      })()}
                    </SpaceBetween>
                  </Container>
                ))}
              </SpaceBetween>
            </ExpandableSection>
          )
        })
        )}
      </SpaceBetween>

    </Container>
  )
}
