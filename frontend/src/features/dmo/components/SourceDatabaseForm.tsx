import React, { useState, useEffect } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Select, { SelectProps } from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import { useMigrationStore } from '../store/migrationStore'
import { testConnection } from '../services/api'
import { DB_VERSIONS, DEFAULT_PORTS } from '../constants/database'

interface SourceDatabaseFormProps {
  onNext: () => void
  onTest: (message: string, type: 'success' | 'error') => void
}

export const SourceDatabaseForm = ({ onNext, onTest }: SourceDatabaseFormProps) => {
  const {
    source,
    updateSource,
    updateOptions,
    sourceInstanceId,
    sourcePassword,
    sourceWindowsPassword,
    sourcePasswordMethod,
    sourceSecretArn,
    setSourceInstanceId,
    setSourcePassword,
    setSourceWindowsPassword,
    setSourcePasswordMethod,
    setSourceSecretArn,
    configVersion,
  } = useMigrationStore()

  const [testing, setTesting] = useState(false)
  const [formValues, setFormValues] = useState({
    type: source.type || '',
    version: source.version || '',
    host: source.host || '',
    port: source.port || '',
    database: source.database || '',
    authType: source.authType || 'username',
    username: source.username || '',
    passwordMethod: sourcePasswordMethod || 'secretsManager',
    password: sourcePassword || '',
    secretArn: sourceSecretArn || '',
    instanceId: sourceInstanceId || '',
    adminPassword: sourceWindowsPassword || '',
  })

  useEffect(() => {
    setFormValues({
      type: source.type || '',
      version: source.version || '',
      host: source.host || '',
      port: source.port || '',
      database: source.database || '',
      authType: source.authType || 'username',
      username: source.username || '',
      passwordMethod: sourcePasswordMethod || 'secretsManager',
      password: sourcePassword || '',
      secretArn: sourceSecretArn || '',
      instanceId: sourceInstanceId || '',
      adminPassword: sourceWindowsPassword || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configVersion])

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  const formRef = React.useRef(formValues)
  formRef.current = formValues

  useEffect(() => {
    return () => {
      const fv = formRef.current
      const sourceData = {
        type: fv.type,
        version: fv.version,
        host: fv.host,
        port: fv.port,
        database: fv.database,
        authType: fv.authType,
        username: fv.username,
      }
      updateSource(sourceData)
      if (fv.instanceId) setSourceInstanceId(fv.instanceId)
      if (fv.password) setSourcePassword(fv.password)
      if (fv.adminPassword) setSourceWindowsPassword(fv.adminPassword)
      setSourcePasswordMethod(fv.passwordMethod as 'direct' | 'secretsManager')
      if (fv.secretArn) setSourceSecretArn(fv.secretArn)
      if (sourceData.type) updateOptions({ databaseType: sourceData.type })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateField = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }))
    setValidationErrors((prev) => ({ ...prev, [field]: '' }))
  }

  const handleTypeChange = (value: string) => {
    updateField('type', value)
    updateField('version', '')
    if (DEFAULT_PORTS[value]) {
      updateField('port', DEFAULT_PORTS[value].toString())
    }
  }

  const handleTestConnection = async () => {
    setTesting(true)
    try {
      const data = await testConnection({
        instanceId: formValues.instanceId,
        databaseType: formValues.type || 'mysql',
        host: formValues.host || 'localhost',
        port: Number(formValues.port) || 3306,
        database: formValues.database || '',
        username: formValues.username || 'migrationuser',
        password: formValues.password,
      })
      if (data.success) {
        onTest(data.message || 'Source connection successful.', 'success')
      } else {
        onTest(data.error || 'Source connection failed.', 'error')
      }
    } catch (e: any) {
      onTest(`Connection test error: ${e.message}`, 'error')
    }
    setTesting(false)
  }

  const dbTypeOptions: SelectProps.Option[] = [
    { value: 'sqlserver', label: 'Microsoft SQL Server' },
    { value: 'postgresql', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'mongodb', label: 'MongoDB' },
    { value: 'mariadb', label: 'MariaDB' },
  ]

  const versionOptions: SelectProps.Option[] =
    formValues.type && DB_VERSIONS[formValues.type as keyof typeof DB_VERSIONS]
      ? DB_VERSIONS[formValues.type as keyof typeof DB_VERSIONS].map((v) => ({
          value: v,
          label: v,
        }))
      : []

  const authTypeOptions: SelectProps.Option[] = [
    { value: 'username', label: 'Database Authentication' },
    { value: 'windows', label: 'Windows Authentication' },
    { value: 'aws-iam', label: 'AWS IAM' },
    { value: 'azure-ad', label: 'Azure AD' },
  ]

  const passwordMethodOptions: SelectProps.Option[] = [
    { value: 'secretsManager', label: 'AWS Secrets Manager ARN' },
    { value: 'direct', label: 'Enter Password' },
  ]

  // Suppress unused import / state — onNext isn't used inline but kept in the interface
  // for wizard parity with the DMO source.
  void onNext

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Source Database Configuration</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Database Type" errorText={validationErrors.type}>
            <Select
              selectedOption={dbTypeOptions.find((o) => o.value === formValues.type) || null}
              onChange={({ detail }) => handleTypeChange(detail.selectedOption.value || '')}
              options={dbTypeOptions}
              placeholder="Select Database Type"
            />
          </FormField>
          <FormField label="Version" errorText={validationErrors.version}>
            <Select
              selectedOption={versionOptions.find((o) => o.value === formValues.version) || null}
              onChange={({ detail }) => updateField('version', detail.selectedOption.value || '')}
              options={versionOptions}
              placeholder="Select Version"
              disabled={!formValues.type}
            />
          </FormField>
          <FormField label="Host/Server" errorText={validationErrors.host}>
            <Input
              value={formValues.host}
              onChange={({ detail }) => updateField('host', detail.value)}
              placeholder="e.g., localhost or 192.168.1.100"
            />
          </FormField>
          <FormField label="Port">
            <Input
              value={formValues.port}
              onChange={({ detail }) => updateField('port', detail.value)}
              placeholder="Default port"
              type="number"
            />
          </FormField>
          <FormField label="Database Name" errorText={validationErrors.database}>
            <Input
              value={formValues.database}
              onChange={({ detail }) => updateField('database', detail.value)}
              placeholder="Database name"
            />
          </FormField>
          <FormField label="Authentication Type">
            <Select
              selectedOption={authTypeOptions.find((o) => o.value === formValues.authType) || null}
              onChange={({ detail }) =>
                updateField('authType', detail.selectedOption.value || 'username')
              }
              options={authTypeOptions}
            />
          </FormField>
        </ColumnLayout>

        {formValues.authType === 'username' && (
          <SpaceBetween size="m" direction="vertical">
            <ColumnLayout columns={2}>
              <FormField label="DB Username" description="Database authentication username">
                <Input
                  value={formValues.username}
                  onChange={({ detail }) => updateField('username', detail.value)}
                  placeholder="e.g., sa"
                />
              </FormField>
              <FormField
                label="Password Source"
                description="Choose how to provide the database password"
              >
                <Select
                  selectedOption={
                    passwordMethodOptions.find((o) => o.value === formValues.passwordMethod) || null
                  }
                  onChange={({ detail }) =>
                    updateField(
                      'passwordMethod',
                      detail.selectedOption.value || 'secretsManager'
                    )
                  }
                  options={passwordMethodOptions}
                />
              </FormField>
            </ColumnLayout>
            {formValues.passwordMethod === 'direct' && ( // pragma: allowlist secret
              <FormField
                label="DB Password"
                errorText={validationErrors.password}
                description="Password will be stored securely in Secrets Manager"
              >
                <Input
                  value={formValues.password}
                  onChange={({ detail }) => updateField('password', detail.value)}
                  type="password"
                  placeholder="••••••••"
                />
              </FormField>
            )}
            {formValues.passwordMethod === 'secretsManager' && ( // pragma: allowlist secret
              <FormField
                label="Secrets Manager ARN"
                errorText={validationErrors.secretArn}
                description="ARN of the secret containing the database password"
              >
                <Input
                  value={formValues.secretArn}
                  onChange={({ detail }) => updateField('secretArn', detail.value)}
                  placeholder="arn:aws:secretsmanager:us-west-2:123456789:secret:my-db-password"
                />
              </FormField>
            )}
          </SpaceBetween>
        )}
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="Required for direct EC2-to-EC2 migration. The instance must have the database engine installed and SSM agent running."
          >
            EC2 Instance Configuration
          </Header>
        }
      >
        <ColumnLayout columns={2}>
          <FormField
            label="Source EC2 Instance ID"
            errorText={validationErrors.instanceId}
            description="EC2 Instance ID where source database is running"
          >
            <Input
              value={formValues.instanceId}
              onChange={({ detail }) => updateField('instanceId', detail.value)}
              placeholder="i-0123456789abcdef0"
            />
          </FormField>
          <FormField
            label="Administrator Password"
            errorText={validationErrors.adminPassword}
            description="Required for SSM commands and PowerShell remoting"
          >
            <Input
              value={formValues.adminPassword}
              onChange={({ detail }) => updateField('adminPassword', detail.value)}
              type="password"
              placeholder="••••••••"
            />
          </FormField>
        </ColumnLayout>
      </Container>

      <SpaceBetween direction="horizontal" size="xs">
        <Button onClick={handleTestConnection} loading={testing} iconName="status-positive">
          Test Connection
        </Button>
      </SpaceBetween>
    </SpaceBetween>
  )
}
