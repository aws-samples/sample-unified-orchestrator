import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ContentLayout,
  Header,
  SpaceBetween,
  Container,
  FormField,
  Input,
  Select,
  Button,
  Box,
  Spinner,
  Alert,
} from '@cloudscape-design/components'
import { iacAgentApi, PageState } from '../../services/iacAgent'
import { extractApiError } from '../../utils/extractApiError'
import { buildRepoName } from '../../utils/buildRepoName'
import ComposerWizard from './ComposerWizard'
import RuntimeValuesForm from './RuntimeValuesForm'
import GenerateConfirmPanel from './GenerateConfirmPanel'
import CodeReviewPanel from './CodeReviewPanel'
import { parseTestOverrides } from '../../utils/parseTestOverrides'
import { useIacDocsPanel } from '../../hooks/useIacDocsPanel'

const POLL_INTERVAL_MS = 4000

type Step = 'input' | 'wizard' | 'runtime_values' | 'confirm' | 'generating' | 'review' | 'approved' | 'publishing' | 'published' | 'error'

export default function TerraformComposerPage() {
  useIacDocsPanel()
  const [searchParams] = useSearchParams()
  const testOverrides = parseTestOverrides(searchParams.get('test_overrides'))
  const initialMotsId = searchParams.get('mots_id') ?? ''
  const initialEnvironment = searchParams.get('environment') ?? ''

  const [step, setStep] = useState<Step>('input')
  const [motsId, setMotsId] = useState(initialMotsId)
  const [environment, setEnvironment] = useState(initialEnvironment)
  const [envOptions, setEnvOptions] = useState<{ label: string; value: string; description?: string }[]>([])
  const [envLoading, setEnvLoading] = useState(true)
  const [envError, setEnvError] = useState('')
  const [motsIdError, setMotsIdError] = useState('')
  const [appAcronym, setAppAcronym] = useState('')
  const [appAcronymError, setAppAcronymError] = useState('')
  const [itapId, setItapId] = useState('')
  const [applicationName, setApplicationName] = useState('')
  const [formDataLoading, setFormDataLoading] = useState(false)
  const [motsIdVerified, setMotsIdVerified] = useState(false)
  const [baseBranch, setBaseBranch] = useState('main')
  const [githubOwner, setGithubOwner] = useState('ATT-DP5')
  const [repoNameOverride, setRepoNameOverride] = useState('')
  const [executionId, setExecutionId] = useState('')
  const [executionArn, setExecutionArn] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [currentVersion, setCurrentVersion] = useState('v1')
  const [versions, setVersions] = useState<string[]>([])
  const [approvedVersion, setApprovedVersion] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<{ pr_url: string; pr_number: number; branch: string; commit_sha: string } | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [resolving, setResolving] = useState(false)
  const [repoValidating, setRepoValidating] = useState(false)
  const [repoExists, setRepoExists] = useState<boolean | null>(null)
  const [repoValidationError, setRepoValidationError] = useState('')
  const [maintainer1, setMaintainer1] = useState('')
  const [maintainer2, setMaintainer2] = useState('')
  const [maintainer1Error, setMaintainer1Error] = useState('')
  const [maintainer2Error, setMaintainer2Error] = useState('')
  const [creatingRepo, setCreatingRepo] = useState(false)
  const [createRepoError, setCreateRepoError] = useState('')
  const [createRepoSuccess, setCreateRepoSuccess] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Fetch environment config from backend on mount
  useEffect(() => {
    setEnvLoading(true)
    iacAgentApi.getEnvironments().then(({ data }) => {
      const options = data.environment_classes.flatMap((ec) =>
        ec.sub_environments.map((se) => ({
          label: se.label,
          value: se.name,
          description: ec.label,
        }))
      )
      setEnvOptions(options)
    }).catch((err) => {
      setEnvError(extractApiError(err, 'Failed to load environments'))
    }).finally(() => {
      setEnvLoading(false)
    })
  }, [])

  const resolveState = useCallback(async () => {
    if (!motsId || !environment) return
    try {
      const { data } = await iacAgentApi.getSessionStatus(motsId, environment, executionId || undefined, 'direct')
      applyPageState(data)
    } catch (err: unknown) {
      setStep('error')
      setErrorMessage(extractApiError(err, 'Failed to resolve session state'))
    }
  }, [motsId, environment, executionId])

  const applyPageState = (ps: PageState) => {
    switch (ps.state) {
      case 'composer':
        setStep('wizard')
        break
      case 'runtime_values':
        setStep('runtime_values')
        break
      case 'confirm':
        setStep('confirm')
        break
      case 'generating':
        setSessionId(ps.session_id ?? '')
        if (ps.execution_id) setExecutionId(ps.execution_id)
        if (ps.execution_arn) setExecutionArn(ps.execution_arn)
        setStep('generating')
        break
      case 'review':
        setSessionId(ps.session_id ?? '')
        if (ps.execution_id) setExecutionId(ps.execution_id)
        if (ps.execution_arn) setExecutionArn(ps.execution_arn)
        setCurrentVersion(ps.current_version ?? 'v1')
        setVersions(ps.versions ?? [])
        setApprovedVersion(ps.approved_version ?? null)
        setStep('review')
        break
      case 'approved':
        setSessionId(ps.session_id ?? '')
        if (ps.execution_id) setExecutionId(ps.execution_id)
        setCurrentVersion(ps.current_version ?? 'v1')
        setVersions(ps.versions ?? [])
        setApprovedVersion(ps.approved_version ?? null)
        setStep('approved')
        break
      case 'publishing':
        setSessionId(ps.session_id ?? '')
        if (ps.execution_id) setExecutionId(ps.execution_id)
        setStep('publishing')
        break
      case 'published':
        setSessionId(ps.session_id ?? '')
        if (ps.execution_id) setExecutionId(ps.execution_id)
        setCurrentVersion(ps.current_version ?? 'v1')
        setVersions(ps.versions ?? [])
        setApprovedVersion(ps.approved_version ?? null)
        setPublishResult(ps.publish_result ?? null)
        setStep('published')
        break
      case 'error':
        setErrorMessage(ps.message ?? 'An error occurred')
        setStep('error')
        break
      default:
        setStep('error')
        setErrorMessage(`Unknown state: ${ps.state}`)
    }
  }

  // Poll while generating, approved (transitioning to publishing), or publishing
  useEffect(() => {
    if (step === 'generating' || step === 'approved' || step === 'publishing') {
      pollingRef.current = setInterval(resolveState, POLL_INTERVAL_MS)
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [step, resolveState])

  // Auto-resolve when navigated with query params (e.g., from compositions page)
  useEffect(() => {
    if (initialMotsId && initialEnvironment) {
      const autoResolve = async () => {
        setResolving(true)
        try {
          // Fetch catalog to populate appAcronym if not already set
          if (!appAcronym) {
            try {
              const { data: catalog } = await iacAgentApi.getAppCatalog(initialMotsId)
              if (catalog?.app_acronym) {
                setAppAcronym(catalog.app_acronym as string)
              }
            } catch { /* catalog fetch is best-effort */ }
          }
          // Fetch MR application info to populate iTAP number, app acronym,
          // and application name. Best-effort — backend returns found=false if
          // MR is unavailable.
          try {
            const { data } = await iacAgentApi.getApplicationInfo(initialMotsId)
            if (data.found) {
              if (data.itap_id) setItapId(data.itap_id)
              if (data.application_name) setApplicationName(data.application_name)
              if (data.app_acronym && !appAcronym) setAppAcronym(data.app_acronym)
            }
          } catch { /* application-info fetch is best-effort */ }
          const { data } = await iacAgentApi.getSessionStatus(initialMotsId, initialEnvironment, undefined, 'direct')
          applyPageState(data)
        } catch (err: unknown) {
          setStep('error')
          setErrorMessage(extractApiError(err, 'Failed to resolve session state'))
        } finally {
          setResolving(false)
        }
      }
      autoResolve()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const validateAttId = (value: string): boolean =>
    /^[a-zA-Z]{2}\d{4}$/.test(value)

  // Look up application metadata in Migration Refinery as soon as the user
  // commits a MOTS id (on blur or on Enter). Populates iTAP number and app
  // acronym so downstream actions (Validate Repository, Create Repository,
  // Continue) have the canonical iTAP without an extra round-trip.
  // Failures and "not found" responses are reported on the MOTS ID field so
  // the user knows what to fix.
  const handleMotsIdLookup = async () => {
    const id = motsId.trim()
    if (!id) {
      setItapId('')
      setApplicationName('')
      setMotsIdVerified(false)
      return
    }
    if (!/^\d+$/.test(id)) {
      setMotsIdError('MOTS ID must contain only digits')
      setItapId('')
      setApplicationName('')
      setMotsIdVerified(false)
      return
    }
    setMotsIdError('')
    setFormDataLoading(true)
    try {
      const { data } = await iacAgentApi.getApplicationInfo(id)
      if (data.found) {
        if (data.itap_id) {
          setItapId(data.itap_id)
        } else {
          // No itap_id from MR — construct it from the MOTS ID
          setItapId(`apm${id.padStart(7, '0')}`)
        }
        if (data.app_acronym) {
          setAppAcronym(data.app_acronym)
          setAppAcronymError('')
        }
        if (data.application_name) setApplicationName(data.application_name)
        setMotsIdVerified(true)
      } else {
        // MR returned 200 but no record — most likely a typo in the MOTS id.
        setItapId('')
        setApplicationName('')
        setMotsIdVerified(false)
        setMotsIdError('Invalid MOTS ID — not found in Migration Refinery.')
      }
    } catch (err: unknown) {
      // MR is unreachable or returned a non-2xx. Block the flow — an iTAP is
      // required to construct the repo name and call DHP.
      setItapId('')
      setApplicationName('')
      setMotsIdVerified(false)
      setMotsIdError(
        extractApiError(err, 'Could not reach Migration Refinery. Try again.')
      )
    } finally {
      setFormDataLoading(false)
    }
  }

  const handleValidateRepo = async () => {
    if (!motsId.trim()) return
    if (!itapId) {
      setRepoValidationError('Enter a valid MOTS ID first.')
      return
    }
    setRepoValidating(true)
    setRepoValidationError('')
    setRepoExists(null)
    setCreateRepoSuccess(false)
    setCreateRepoError('')
    try {
      const { data } = await iacAgentApi.checkRepoExists(itapId)
      setRepoExists(data.exists)
    } catch (err: unknown) {
      setRepoValidationError(extractApiError(err, 'Failed to validate repository'))
    } finally {
      setRepoValidating(false)
    }
  }

  const handleCreateRepo = async () => {
    setMaintainer1Error('')
    setMaintainer2Error('')
    setCreateRepoError('')
    if (!itapId) {
      setCreateRepoError('iTAP number was not resolved from Migration Refinery. Re-validate the repository before creating.')
      return
    }
    if (!validateAttId(maintainer1.trim())) {
      setMaintainer1Error('Must be a valid ATT ID (e.g. ab1234)')
      return
    }
    if (!validateAttId(maintainer2.trim())) {
      setMaintainer2Error('Must be a valid ATT ID (e.g. ab1234)')
      return
    }
    if (maintainer1.trim().toLowerCase() === maintainer2.trim().toLowerCase()) {
      setMaintainer2Error('Maintainers must be different')
      return
    }
    setCreatingRepo(true)
    try {
      const finalRepoName = buildRepoName(itapId, appAcronym, repoNameOverride)
      if (!finalRepoName) {
        setCreateRepoError('Repo name is empty. Provide an App Acronym or a Repo Name Override.')
        setCreatingRepo(false)
        return
      }
      await iacAgentApi.createRepo({
        itap_id: itapId,
        organization: githubOwner || 'ATT-DP5',
        repo_name: finalRepoName,
        app_acronym: appAcronym.trim() || undefined,
        teams: [{
          action: 'create_new',
          permission: 'admin',
          maintainers: [maintainer1.trim().toLowerCase(), maintainer2.trim().toLowerCase()],
        }],
      })
      setCreateRepoSuccess(true)
      setRepoExists(true)
    } catch (err: unknown) {
      setCreateRepoError(extractApiError(err, 'Failed to create repository'))
    } finally {
      setCreatingRepo(false)
    }
  }

  const handleContinue = async () => {
    // Validate MOTS ID — integers only
    if (!motsId.trim()) {
      setMotsIdError('MOTS ID is required')
      return
    }
    if (!/^\d+$/.test(motsId.trim())) {
      setMotsIdError('MOTS ID must contain only digits')
      return
    }
    if (!itapId) {
      setMotsIdError('Invalid MOTS ID — iTAP not resolved.')
      return
    }
    if (!environment) {
      return
    }
    // Validate app acronym
    if (!appAcronym.trim()) {
      setAppAcronymError('App acronym is required')
      return
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(appAcronym.trim())) {
      setAppAcronymError('Only letters, digits, hyphens, and underscores allowed')
      return
    }
    setMotsIdError('')
    setAppAcronymError('')
    setResolving(true)
    try {
      // Persist app_acronym to catalog (best-effort, for future sessions)
      try {
        const { data: catalog } = await iacAgentApi.getAppCatalog(motsId.trim())
        if (catalog?.app_composition && (!catalog.app_acronym || catalog.app_acronym !== appAcronym.trim())) {
          await iacAgentApi.saveComposition(motsId.trim(), {
            ...(catalog.app_composition as { blueprints: { blueprint_name: string; version: string; instances: { instance_name: string }[] }[] }),
            app_acronym: appAcronym.trim(),
          })
        }
      } catch { /* best-effort — don't block the flow */ }

      const { data } = await iacAgentApi.getSessionStatus(motsId.trim(), environment, undefined, 'direct')
      applyPageState(data)
    } catch (err: unknown) {
      setStep('error')
      setErrorMessage(extractApiError(err, 'Failed to resolve session state'))
    } finally {
      setResolving(false)
    }
  }

  const handleGenerated = (newExecutionId: string, newExecutionArn?: string) => {
    setExecutionId(newExecutionId)
    if (newExecutionArn) setExecutionArn(newExecutionArn)
    setStep('generating')
  }

  const handleCancel = async () => {
    if (!executionArn) return
    setCancelling(true)
    setCancelError('')
    try {
      await iacAgentApi.cancelGeneration(executionArn)
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setExecutionArn('')
      setErrorMessage('Generation cancelled by user')
      setStep('error')
    } catch (err: unknown) {
      setCancelError(extractApiError(err, 'Failed to cancel generation'))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <ContentLayout header={<Header variant="h1">Terraform Composer</Header>}>
      <SpaceBetween size="l">
        {testOverrides && (
          <Alert type="info">
            Testing with draft overrides:{' '}
            {Object.entries(testOverrides)
              .map(([type, ver]) => `${type.replace('_', ' ')} ${ver}`)
              .join(', ')}
          </Alert>
        )}
        {renderStep()}
      </SpaceBetween>
    </ContentLayout>
  )

  function renderStep() {
    switch (step) {
      case 'input':
        return (
          <Container header={<Header variant="h2">Select Application</Header>}>
            <SpaceBetween size="l">
              <FormField label="MOTS ID" errorText={motsIdError} description={formDataLoading ? 'Looking up application in Migration Refinery...' : ''}>
                <Input
                  value={motsId}
                  onChange={({ detail }) => {
                    setMotsId(detail.value)
                    setMotsIdError('')
                    // Reset MR-fetched values when MOTS ID changes so the user
                    // re-validates against the new id.
                    setItapId('')
                    setAppAcronym('')
                    setApplicationName('')
                    setRepoExists(null)
                    setMotsIdVerified(false)
                  }}
                  onBlur={handleMotsIdLookup}
                  onKeyDown={({ detail }) => {
                    if (detail.key === 'Enter') {
                      handleMotsIdLookup()
                    }
                  }}
                  placeholder="Enter MOTS ID (digits only)"
                  inputMode="numeric"
                />
              </FormField>
              <FormField label="Environment" errorText={envError}>
                <Select
                  selectedOption={envOptions.find((o) => o.value === environment) ?? null}
                  onChange={({ detail }) => setEnvironment(detail.selectedOption.value ?? '')}
                  options={envOptions}
                  placeholder="Select environment"
                  loadingText="Loading environments..."
                  statusType={envLoading ? 'loading' : envError ? 'error' : 'finished'}
                  empty="No environments available"
                  disabled={formDataLoading || !motsIdVerified}
                />
              </FormField>
              <FormField
                label="App Acronym"
                description="Customer application acronym for repo naming. Auto-populated from Migration Refinery — editable if the value needs adjustment."
                errorText={appAcronymError}
              >
                <Input
                  value={appAcronym}
                  onChange={({ detail }) => { setAppAcronym(detail.value); setAppAcronymError('') }}
                  placeholder="e.g. myapp"
                  disabled={formDataLoading || !motsIdVerified}
                />
              </FormField>
              <FormField label="Base Branch" description="Target branch for the GitHub PR">
                <Input
                  value={baseBranch}
                  onChange={({ detail }) => setBaseBranch(detail.value)}
                  placeholder="main"
                  disabled={formDataLoading || !motsIdVerified}
                />
              </FormField>
              <FormField label="GitHub Owner" description="GitHub organization or user that owns the target repo">
                <Input
                  value={githubOwner}
                  onChange={({ detail }) => setGithubOwner(detail.value)}
                  placeholder="ATT-DP5"
                  disabled={formDataLoading || !motsIdVerified}
                />
              </FormField>
              <FormField label="Repo Name Override" description="Optional — overrides the constructed repo name entirely. For admin testing with custom repos.">
                <Input
                  value={repoNameOverride}
                  onChange={({ detail }) => {
                    setRepoNameOverride(detail.value)
                    setRepoExists(null)
                    setCreateRepoSuccess(false)
                  }}
                  placeholder="Leave empty to use default naming convention"
                  disabled={formDataLoading || !motsIdVerified}
                />
              </FormField>
              {itapId && (
                <Alert type="info">
                  PR will target: <strong>{githubOwner || 'ATT-DP5'}/{buildRepoName(itapId, appAcronym, repoNameOverride) || '?'}</strong> → {baseBranch || 'main'}
                </Alert>
              )}
              <SpaceBetween size="s">
                <Button
                  onClick={handleValidateRepo}
                  loading={repoValidating || formDataLoading}
                  disabled={repoValidating || formDataLoading || !motsId.trim() || !itapId}
                >
                  Validate Repository
                </Button>
                {(itapId || applicationName) && (
                  <Alert type="info" header="Application metadata">
                    <SpaceBetween size="xxs">
                      {itapId && <div>iTAP Number: <strong>{itapId}</strong></div>}
                      {applicationName && <div>Application Name: <strong>{applicationName}</strong></div>}
                      {appAcronym && <div>App Acronym: <strong>{appAcronym}</strong></div>}
                    </SpaceBetween>
                  </Alert>
                )}
                {repoValidationError && <Alert type="error">{repoValidationError}</Alert>}
                {repoExists === true && (
                  <Alert type="success">Repository exists for this MOTS ID. You can proceed.</Alert>
                )}
                {repoExists === false && !createRepoSuccess && (
                  <Container header={<Header variant="h3">Create Repository</Header>}>
                    <SpaceBetween size="m">
                      <Alert type="warning">
                        No repository found for MOTS ID <strong>{motsId.trim()}</strong>{itapId && <> (iTAP <strong>{itapId}</strong>)</>}. Provide 2 maintainers to create it.
                      </Alert>
                      <FormField
                        label="Maintainer 1 (ATT ID)"
                        errorText={maintainer1Error}
                        constraintText="Format: 2 letters followed by 4 digits (e.g. ab1234)"
                      >
                        <Input
                          value={maintainer1}
                          onChange={({ detail }) => {
                            setMaintainer1(detail.value.slice(0, 6))
                            setMaintainer1Error('')
                          }}
                          placeholder="e.g. ab1234"
                        />
                      </FormField>
                      <FormField
                        label="Maintainer 2 (ATT ID)"
                        errorText={maintainer2Error}
                        constraintText="Format: 2 letters followed by 4 digits (e.g. cd5678)"
                      >
                        <Input
                          value={maintainer2}
                          onChange={({ detail }) => {
                            setMaintainer2(detail.value.slice(0, 6))
                            setMaintainer2Error('')
                          }}
                          placeholder="e.g. cd5678"
                        />
                      </FormField>
                      {createRepoError && <Alert type="error">{createRepoError}</Alert>}
                      <Button
                        variant="primary"
                        onClick={handleCreateRepo}
                        loading={creatingRepo}
                        disabled={creatingRepo || !maintainer1.trim() || !maintainer2.trim()}
                      >
                        Create Repository
                      </Button>
                    </SpaceBetween>
                  </Container>
                )}
                {createRepoSuccess && (
                  <Alert type="success">Repository created successfully.</Alert>
                )}
              </SpaceBetween>
              <Button variant="primary" onClick={handleContinue} loading={resolving} disabled={resolving || formDataLoading || !motsId.trim() || !environment || !appAcronym.trim() || !itapId || repoExists !== true}>
                Continue
              </Button>
            </SpaceBetween>
          </Container>
        )

      case 'wizard':
        return (
          <ComposerWizard
            motsId={motsId}
            appAcronym={appAcronym}
            onComplete={resolveState}
          />
        )

      case 'runtime_values':
        return (
          <RuntimeValuesForm
            motsId={motsId}
            environment={environment}
            onComplete={resolveState}
          />
        )

      case 'confirm':
        return (
          <GenerateConfirmPanel
            motsId={motsId}
            environment={environment}
            appAcronym={appAcronym}
            baseBranch={baseBranch}
            githubOwner={githubOwner}
            repoNameOverride={repoNameOverride}
            itapId={itapId}
            onGenerated={handleGenerated}
            onEditRuntimeValues={() => setStep('runtime_values')}
            configOverrides={testOverrides}
          />
        )

      case 'generating':
        return (
          <Container header={<Header variant="h2">Generating Terraform Code</Header>}>
            <Box textAlign="center" padding="xl">
              <Spinner size="large" />
              <Box variant="p" margin={{ top: 's' }}>
                Code generation in progress. This may take a few minutes...
              </Box>
              {sessionId && (
                <Box variant="small" color="text-body-secondary">
                  Session: {sessionId}
                </Box>
              )}
              <Box margin={{ top: 'l' }}>
                <Button
                  variant="normal"
                  onClick={handleCancel}
                  loading={cancelling}
                  disabled={cancelling || !executionArn}
                >
                  Cancel Generation
                </Button>
              </Box>
              {cancelError && (
                <Box margin={{ top: 's' }}>
                  <Alert type="error">{cancelError}</Alert>
                </Box>
              )}
            </Box>
          </Container>
        )

      case 'review':
        return (
          <SpaceBetween size="s">
            {cancelError && <Alert type="error">{cancelError}</Alert>}
            <CodeReviewPanel
              sessionId={sessionId}
              currentVersion={currentVersion}
              versions={versions}
              approvedVersion={approvedVersion}
              onApproved={resolveState}
              onFeedbackSubmitted={() => setStep('generating')}
              onCancel={handleCancel}
              cancelLoading={cancelling}
            />
          </SpaceBetween>
        )

      case 'approved':
        return (
          <SpaceBetween size="l">
            <Alert type="info" statusIconAriaLabel="Info">
              <Box display="inline-block" margin={{ right: 'xs' }}>
                <Spinner size="normal" />
              </Box>
              Code approved. Publishing PR to GitHub...
            </Alert>
            <CodeReviewPanel
              sessionId={sessionId}
              currentVersion={currentVersion}
              versions={versions}
              approvedVersion={approvedVersion}
              onApproved={resolveState}
              readOnly
            />
          </SpaceBetween>
        )

      case 'publishing':
        return (
          <Container header={<Header variant="h2">Publishing to GitHub</Header>}>
            <Box textAlign="center" padding="xl">
              <Spinner size="large" />
              <Box variant="p" margin={{ top: 's' }}>
                Creating pull request on GitHub. This may take a moment...
              </Box>
              {sessionId && (
                <Box variant="small" color="text-body-secondary">
                  Session: {sessionId}
                </Box>
              )}
            </Box>
          </Container>
        )

      case 'published':
        return (
          <SpaceBetween size="l">
            {publishResult?.pr_url && (
              <Alert type="success" header="Pull Request Created">
                PR #{publishResult.pr_number} opened on branch <strong>{publishResult.branch}</strong>:{' '}
                <a href={publishResult.pr_url} target="_blank" rel="noopener noreferrer">{publishResult.pr_url}</a>
              </Alert>
            )}
            <CodeReviewPanel
              sessionId={sessionId}
              currentVersion={currentVersion}
              versions={versions}
              approvedVersion={approvedVersion}
              onApproved={resolveState}
              readOnly
            />
          </SpaceBetween>
        )

      case 'error':
        return (
          <Alert type="error" header="Error">
            {errorMessage || 'An error occurred during code generation.'}
          </Alert>
        )

      default:
        return <Alert type="warning">Unknown step</Alert>
    }
  }
}
