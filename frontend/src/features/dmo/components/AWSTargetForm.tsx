import React, { useState, useEffect } from 'react'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Select, { SelectProps } from '@cloudscape-design/components/select'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import Alert from '@cloudscape-design/components/alert'
import { useMigrationStore } from '../store/migrationStore'
import { testConnection } from '../services/api'
import { AWS_REGIONS, AWS_ENGINES, DEFAULT_PORTS } from '../constants/database'

interface AWSTargetFormProps {
  onNext: () => void
  onPrev: () => void
  onTest: (message: string, type: 'success' | 'error') => void
}

export const AWSTargetForm = ({ onNext, onPrev, onTest }: AWSTargetFormProps) => {
  void onNext
  void onPrev
  const {
    target,
    updateTarget,
    targetInstanceId,
    targetPassword,
    targetWindowsPassword,
    targetPasswordMethod,
    targetSecretArn,
    setTargetInstanceId,
    setTargetPassword,
    setTargetWindowsPassword,
    setTargetPasswordMethod,
    setTargetSecretArn,
    configVersion,
  } = useMigrationStore()

  const [testing, setTesting] = useState(false)
  const [f, setF] = useState({
    serviceType: target.serviceType || '',
    engine: target.engine || '',
    targetInstanceId: targetInstanceId || '',
    targetWindowsPassword: targetWindowsPassword || '',
    endpoint: target.endpoint || '',
    port: target.port || '',
    database: target.database || '',
    authMethod: target.authMethod || 'username',
    username: target.username || '',
    targetPasswordMethod: targetPasswordMethod || 'secretsManager',
    targetPassword: targetPassword || '',
    targetSecretArn: targetSecretArn || '',
    secretsManagerArn: target.secretsManagerArn || '',
    backupStorageMethod: target.backupStorageMethod || '',
    s3Bucket: target.s3Bucket || '',
    region: target.region || '',
    fsxId: target.fsxId || '',
    fsxPath: target.fsxPath || '',
    networkSharePath: target.networkSharePath || '',
    shareUsername: target.shareUsername || '',
    sharePassword: target.sharePassword || '',
  })
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  const fRef = React.useRef(f)
  fRef.current = f

  useEffect(() => {
    return () => {
      const fv = fRef.current
      const targetData: Record<string, any> = {
        serviceType: fv.serviceType,
        engine: fv.engine,
        endpoint: fv.endpoint,
        port: fv.port,
        database: fv.database,
        authMethod: fv.authMethod,
        username: fv.username,
        backupStorageMethod: fv.backupStorageMethod,
        s3Bucket: fv.s3Bucket,
        region: fv.region,
        fsxId: fv.fsxId,
        fsxPath: fv.fsxPath,
        networkSharePath: fv.networkSharePath,
        shareUsername: fv.shareUsername,
        sharePassword: fv.sharePassword,
        secretsManagerArn: fv.secretsManagerArn,
      }
      updateTarget(targetData)
      if (fv.targetInstanceId) setTargetInstanceId(fv.targetInstanceId)
      if (fv.targetPassword) setTargetPassword(fv.targetPassword)
      if (fv.targetWindowsPassword) setTargetWindowsPassword(fv.targetWindowsPassword)
      setTargetPasswordMethod(fv.targetPasswordMethod as 'direct' | 'secretsManager')
      if (fv.targetSecretArn) setTargetSecretArn(fv.targetSecretArn)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setF({
      serviceType: target.serviceType || '',
      engine: target.engine || '',
      targetInstanceId: targetInstanceId || '',
      targetWindowsPassword: targetWindowsPassword || '',
      endpoint: target.endpoint || '',
      port: target.port || '',
      database: target.database || '',
      authMethod: target.authMethod || 'username',
      username: target.username || '',
      targetPasswordMethod: targetPasswordMethod || 'secretsManager',
      targetPassword: targetPassword || '',
      targetSecretArn: targetSecretArn || '',
      secretsManagerArn: target.secretsManagerArn || '',
      backupStorageMethod: target.backupStorageMethod || '',
      s3Bucket: target.s3Bucket || '',
      region: target.region || '',
      fsxId: target.fsxId || '',
      fsxPath: target.fsxPath || '',
      networkSharePath: target.networkSharePath || '',
      shareUsername: target.shareUsername || '',
      sharePassword: target.sharePassword || '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configVersion])

  const up = (field: string, value: string) => {
    setF((prev) => ({ ...prev, [field]: value }))
    setValidationErrors((prev) => ({ ...prev, [field]: '' }))
  }

  const handleServiceTypeChange = (value: string) => {
    up('serviceType', value)
    up('engine', '')
  }

  const handleEngineChange = (value: string) => {
    up('engine', value)
    if (DEFAULT_PORTS[value]) up('port', DEFAULT_PORTS[value].toString())
  }

  const handleTestConnection = async () => {
    setTesting(true)
    try {
      const data = await testConnection({
        instanceId: f.targetInstanceId,
        databaseType: f.engine || 'mysql',
        host: f.endpoint || 'localhost',
        port: Number(f.port) || 3306,
        database: f.database || '',
        username: f.username || 'migrationuser',
        password: f.targetPassword,
      })
      onTest(
        data.success
          ? data.message || 'Target connection successful.'
          : data.error || 'Target connection failed.',
        data.success ? 'success' : 'error'
      )
    } catch (e: any) {
      onTest(`Connection test error: ${e.message}`, 'error')
    }
    setTesting(false)
  }

  const serviceTypeOptions: SelectProps.Option[] = [
    { value: 'rds', label: 'Amazon RDS' },
    { value: 'rds-custom', label: 'Amazon RDS Custom' },
    { value: 'ec2', label: 'Amazon EC2' },
    { value: 'aurora', label: 'Amazon Aurora' },
  ]

  const engineOptions: SelectProps.Option[] =
    f.serviceType && AWS_ENGINES[f.serviceType as keyof typeof AWS_ENGINES]
      ? AWS_ENGINES[f.serviceType as keyof typeof AWS_ENGINES].map((e) => ({
          value: e,
          label: e.toUpperCase(),
        }))
      : []

  const regionOptions: SelectProps.Option[] = AWS_REGIONS.map((r) => ({
    value: r.value,
    label: r.label,
  }))

  const authMethodOptions: SelectProps.Option[] = [
    { value: 'username', label: 'Database Authentication' },
    { value: 'iam', label: 'AWS IAM Database Authentication' },
    { value: 'secrets-manager', label: 'AWS Secrets Manager' },
  ]

  const passwordMethodOptions: SelectProps.Option[] = [
    { value: 'secretsManager', label: 'AWS Secrets Manager ARN' },
    { value: 'direct', label: 'Enter Password' },
  ]

  const backupStorageOptions: SelectProps.Option[] = [
    { value: 'direct', label: 'Direct Copy (EC2 to EC2 - Recommended)' },
    { value: 's3', label: 'Amazon S3 (Required for RDS)' },
    { value: 'fsx', label: 'Amazon FSx for Windows' },
    { value: 'network-share', label: 'Network Share / File Server' },
  ]

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Target Instance Information</Header>}>
        <ColumnLayout columns={2}>
          <FormField label="Service Type" errorText={validationErrors.serviceType}>
            <Select
              selectedOption={serviceTypeOptions.find((o) => o.value === f.serviceType) || null}
              onChange={({ detail }) => handleServiceTypeChange(detail.selectedOption.value || '')}
              options={serviceTypeOptions}
              placeholder="Select AWS Service"
            />
          </FormField>
          <FormField label="Database Engine" errorText={validationErrors.engine}>
            <Select
              selectedOption={engineOptions.find((o) => o.value === f.engine) || null}
              onChange={({ detail }) => handleEngineChange(detail.selectedOption.value || '')}
              options={engineOptions}
              placeholder="Select Engine"
              disabled={!f.serviceType}
            />
          </FormField>
        </ColumnLayout>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            description="The target instance must have the database engine installed and SSM agent running."
          >
            Target EC2 Instance Configuration
          </Header>
        }
      >
        <ColumnLayout columns={2}>
          <FormField
            label="Target EC2 Instance ID"
            errorText={validationErrors.targetInstanceId}
            description="EC2 instance ID where database will be restored"
          >
            <Input
              value={f.targetInstanceId}
              onChange={({ detail }) => up('targetInstanceId', detail.value)}
              placeholder="i-0123456789abcdef1"
            />
          </FormField>
          <FormField
            label="Target Administrator Password"
            errorText={validationErrors.targetWindowsPassword}
            description="Required for SSM commands and PowerShell remoting"
          >
            <Input
              value={f.targetWindowsPassword}
              onChange={({ detail }) => up('targetWindowsPassword', detail.value)}
              type="password"
              placeholder="••••••••"
            />
          </FormField>
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h2">Connection Details</Header>}>
        <ColumnLayout columns={2}>
          <FormField
            label="Endpoint/Host"
            errorText={validationErrors.endpoint}
            description="RDS endpoint or EC2 instance IP address"
          >
            <Input
              value={f.endpoint}
              onChange={({ detail }) => up('endpoint', detail.value)}
              placeholder="e.g., mydb.abc123.us-east-1.rds.amazonaws.com"
            />
          </FormField>
          <FormField
            label="Port"
            errorText={validationErrors.port}
            description="Default port for the selected database engine"
          >
            <Input
              value={f.port}
              onChange={({ detail }) => up('port', detail.value)}
              type="number"
              placeholder="1433"
            />
          </FormField>
          <FormField
            label="Target Database Name"
            errorText={validationErrors.database}
            description="Database will be created if it doesn't exist"
          >
            <Input
              value={f.database}
              onChange={({ detail }) => up('database', detail.value)}
              placeholder="Database name on target"
            />
          </FormField>
        </ColumnLayout>
      </Container>

      <Container header={<Header variant="h2">Authentication</Header>}>
        <SpaceBetween size="m">
          <ColumnLayout columns={2}>
            <FormField label="Authentication Method">
              <Select
                selectedOption={authMethodOptions.find((o) => o.value === f.authMethod) || null}
                onChange={({ detail }) =>
                  up('authMethod', detail.selectedOption.value || 'username')
                }
                options={authMethodOptions}
              />
            </FormField>
          </ColumnLayout>
          {f.authMethod === 'username' && (
            <ColumnLayout columns={2}>
              <FormField
                label="DB Username"
                description="Database authentication username for target"
              >
                <Input
                  value={f.username}
                  onChange={({ detail }) => up('username', detail.value)}
                  placeholder="e.g., sa"
                />
              </FormField>
              <FormField
                label="Password Source"
                description="Choose how to provide the database password"
              >
                <Select
                  selectedOption={
                    passwordMethodOptions.find((o) => o.value === f.targetPasswordMethod) || null
                  }
                  onChange={({ detail }) =>
                    up('targetPasswordMethod', detail.selectedOption.value || 'secretsManager')
                  }
                  options={passwordMethodOptions}
                />
              </FormField>
            </ColumnLayout>
          )}
          {f.authMethod === 'username' && f.targetPasswordMethod === 'direct' && ( // pragma: allowlist secret
            <FormField
              label="Target DB Password"
              errorText={validationErrors.targetPassword}
              description="Password will be stored securely in Secrets Manager"
            >
              <Input
                value={f.targetPassword}
                onChange={({ detail }) => up('targetPassword', detail.value)}
                type="password"
                placeholder="••••••••"
              />
            </FormField>
          )}
          {f.authMethod === 'username' && f.targetPasswordMethod === 'secretsManager' && ( // pragma: allowlist secret
            <FormField
              label="Secrets Manager ARN"
              errorText={validationErrors.targetSecretArn}
              description="ARN of the secret containing the target database password"
            >
              <Input
                value={f.targetSecretArn}
                onChange={({ detail }) => up('targetSecretArn', detail.value)}
                placeholder="arn:aws:secretsmanager:us-west-2:123456789:secret:my-db-password"
              />
            </FormField>
          )}
          {f.authMethod === 'secrets-manager' && (
            <FormField label="Secrets Manager ARN">
              <Input
                value={f.secretsManagerArn}
                onChange={({ detail }) => up('secretsManagerArn', detail.value)}
                placeholder="arn:aws:secretsmanager:region:account:secret:name"
              />
            </FormField>
          )}
        </SpaceBetween>
      </Container>

      <Container header={<Header variant="h2">Backup Storage</Header>}>
        <SpaceBetween size="m">
          <FormField
            label="Backup Storage Method"
            errorText={validationErrors.backupStorageMethod}
            description={
              f.serviceType === 'rds' || f.serviceType === 'aurora'
                ? 'RDS requires S3 or FSx for native backup/restore'
                : 'Direct Copy is recommended for EC2-to-EC2 migration'
            }
          >
            <Select
              selectedOption={
                backupStorageOptions.find((o) => o.value === f.backupStorageMethod) || null
              }
              onChange={({ detail }) =>
                up('backupStorageMethod', detail.selectedOption.value || '')
              }
              options={backupStorageOptions}
              placeholder="Select Storage Method"
            />
          </FormField>
          {f.backupStorageMethod === 'direct' && (
            <Alert type="success" header="Direct Copy Mode (No S3 Required)">
              Backup files will be created on source EC2 and copied directly to target EC2 via
              PowerShell remoting. This is the fastest and most cost-effective method for
              EC2-to-EC2 migrations.
            </Alert>
          )}
          {f.backupStorageMethod === 's3' && (
            <ColumnLayout columns={2}>
              <FormField
                label="S3 Bucket Name"
                errorText={validationErrors.s3Bucket}
                description="S3 bucket for staging backup files"
              >
                <Input
                  value={f.s3Bucket}
                  onChange={({ detail }) => up('s3Bucket', detail.value)}
                  placeholder="my-migration-bucket"
                />
              </FormField>
              <FormField label="AWS Region" errorText={validationErrors.region}>
                <Select
                  selectedOption={regionOptions.find((o) => o.value === f.region) || null}
                  onChange={({ detail }) => up('region', detail.selectedOption.value || '')}
                  options={regionOptions}
                  placeholder="Select Region"
                />
              </FormField>
            </ColumnLayout>
          )}
          {f.backupStorageMethod === 'fsx' && (
            <ColumnLayout columns={2}>
              <FormField
                label="FSx File System ID"
                errorText={validationErrors.fsxId}
                description="Amazon FSx for Windows File Server ID"
              >
                <Input
                  value={f.fsxId}
                  onChange={({ detail }) => up('fsxId', detail.value)}
                  placeholder="fs-0123456789abcdef0"
                />
              </FormField>
              <FormField
                label="FSx Mount Path"
                errorText={validationErrors.fsxPath}
                description="UNC path to FSx share"
              >
                <Input
                  value={f.fsxPath}
                  onChange={({ detail }) => up('fsxPath', detail.value)}
                  placeholder="\\fs-0123456789abcdef0.example.com\share"
                />
              </FormField>
            </ColumnLayout>
          )}
          {f.backupStorageMethod === 'network-share' && (
            <ColumnLayout columns={2}>
              <FormField
                label="Network Share Path"
                errorText={validationErrors.networkSharePath}
                description="UNC path to network file share"
              >
                <Input
                  value={f.networkSharePath}
                  onChange={({ detail }) => up('networkSharePath', detail.value)}
                  placeholder="\\fileserver\backups"
                />
              </FormField>
              <FormField
                label="Share Username"
                description="Leave empty for current user credentials"
              >
                <Input
                  value={f.shareUsername}
                  onChange={({ detail }) => up('shareUsername', detail.value)}
                  placeholder="domain\username"
                />
              </FormField>
              <FormField label="Share Password">
                <Input
                  value={f.sharePassword}
                  onChange={({ detail }) => up('sharePassword', detail.value)}
                  type="password"
                  placeholder="••••••••"
                />
              </FormField>
            </ColumnLayout>
          )}
        </SpaceBetween>
      </Container>

      <SpaceBetween direction="horizontal" size="xs">
        <Button onClick={handleTestConnection} loading={testing} iconName="status-positive">
          Test AWS Connection
        </Button>
      </SpaceBetween>
    </SpaceBetween>
  )
}
