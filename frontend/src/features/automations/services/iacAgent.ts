import automationsClient from './api'

const BASE = '/iac-agent'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageState {
  state: 'composer' | 'runtime_values' | 'confirm' | 'generating' | 'review' | 'approved' | 'publishing' | 'published' | 'error'
  session_id?: string
  execution_id?: string
  execution_arn?: string
  current_version?: string
  versions?: string[]
  approved_version?: string
  publish_result?: { pr_url: string; pr_number: number; branch: string; commit_sha: string }
  message?: string
}

export interface BlueprintInstance {
  instance_name: string
}

export interface BlueprintSelection {
  blueprint_name: string
  version: string
  instances: BlueprintInstance[]
}

export interface SaveCompositionPayload {
  blueprints: BlueprintSelection[]
  app_acronym?: string
}

export interface SaveRuntimeValuesPayload {
  values: Record<string, unknown>
}

export interface Blueprint {
  blueprint_name: string
  version: string
  description?: string
  parameters_schema?: Record<string, unknown>
  category?: string
  status?: string
}

export interface SessionFiles {
  [filename: string]: string
}

export interface GenerateDirectResponse {
  execution_id: string
  execution_arn: string
  status: string
}

export interface SessionSummary {
  session_id: string
  status: string
  environment: string
  created_at: string
  updated_at: string
  current_version: string
  versions: string[]
  approved_version: string | null
}

export interface ConfigVersion {
  pk: string
  sk: string
  content: string
  version: number
  status: 'draft' | 'active' | 'inactive'
  created_by: string
  created_at: string
  updated_at: string
  description: string
}

export interface CreateConfigVersionPayload {
  content: string
  created_by: string
  description?: string
}

export interface UpdateConfigVersionPayload {
  content?: string
  description?: string
}

export interface EnvironmentSubEnv {
  name: string
  label: string
}

export interface EnvironmentClass {
  class: string
  label: string
  env_class_suffix: string
  sub_environments: EnvironmentSubEnv[]
}

export interface EnvironmentConfig {
  environment_classes: EnvironmentClass[]
}

export interface RepoCheckResponse {
  itap: string
  exists: boolean
  repos: Array<{ name?: string; url?: string }>
}

export interface RepoFormDataResponse {
  organization: string
  primary_contact: string
  primary_owner: string
  application_name: string
  app_acronym: string
  description: string
  itap_id: string
  editable_fields: string[]
}

export interface RepoCreatePayload {
  itap_id: string
  organization: string
  repo_name: string
  app_acronym?: string
  teams: Array<{
    action: 'create_new'
    permission: 'admin'
    maintainers: [string, string]
  }>
  description?: string
}

export interface RepoCreateResponse {
  mots_id: string
  repo_name: string
  team_names: string[]
  repo_url: string
  status: string
  failed_secrets: string[]
  scaffold_error?: string
  branch_protection_error?: string
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const iacAgentApi = {
  getEnvironments: () =>
    automationsClient.get<EnvironmentConfig>(`${BASE}/environments`),

  getActiveSessions: () =>
    automationsClient.get<Array<PageState & { mots_id: string; environment: string }>>(`${BASE}/session/active-sessions`),

  getSessionStatus: (motsId: string, environment: string, executionId?: string, source?: string) =>
    automationsClient.get<PageState>(`${BASE}/session/status`, {
      params: {
        mots_id: motsId,
        environment,
        ...(executionId ? { execution_id: executionId } : {}),
        ...(source ? { source } : {}),
      },
    }),

  getSessionFiles: (sessionId: string, version: string) =>
    automationsClient.get<SessionFiles>(`${BASE}/session/${sessionId}/files/${version}`),

  resumeInput: (executionId: string, motsId: string, environment: string) =>
    automationsClient.post(`${BASE}/resume-input`, {
      execution_id: executionId,
      mots_id: motsId,
      environment,
    }),

  submitFeedback: (sessionId: string, feedback: string) =>
    automationsClient.post(`${BASE}/feedback`, {
      session_id: sessionId,
      feedback,
    }),

  approve: (sessionId: string) =>
    automationsClient.post(`${BASE}/approve`, { session_id: sessionId }),

  getAppCatalog: (motsId: string) =>
    automationsClient.get(`${BASE}/app-catalog/${motsId}`),

  getApplicationInfo: (motsId: string) =>
    automationsClient.get<{
      found: boolean
      mots_id: string
      app_acronym: string
      itap_id: string
      application_name: string
    }>(`${BASE}/application-info/${motsId}`),

  saveComposition: (motsId: string, payload: SaveCompositionPayload) =>
    automationsClient.put(`${BASE}/app-catalog/${motsId}/composition`, payload),

  saveRuntimeValues: (motsId: string, environment: string, payload: SaveRuntimeValuesPayload) =>
    automationsClient.put(`${BASE}/app-catalog/${motsId}/runtime-values/${environment}`, payload),

  listBlueprints: () =>
    automationsClient.get<Blueprint[]>(`${BASE}/blueprints`),

  getBlueprint: (name: string, version: string) =>
    automationsClient.get<Blueprint>(`${BASE}/blueprints/${name}/${version}`),

  deleteComposition: (motsId: string) =>
    automationsClient.delete(`${BASE}/app-catalog/${motsId}`),

  listAppCatalogs: () =>
    automationsClient.get(`${BASE}/app-catalog`),

  generateDirect: (motsId: string, environment: string, appAcronym: string, repoName: string, baseBranch = 'main', githubOwner = 'ATT-DP5', configOverrides?: Record<string, string>) =>
    automationsClient.post<GenerateDirectResponse>(`${BASE}/generate`, {
      mots_id: motsId,
      environment,
      app_acronym: appAcronym,
      repo_name: repoName,
      base_branch: baseBranch,
      github_owner: githubOwner,
      ...(configOverrides ? { config_overrides: configOverrides } : {}),
    }),

  cancelGeneration: (executionArn: string) =>
    automationsClient.post<{ execution_arn: string; status: string }>(`${BASE}/cancel`, {
      execution_arn: executionArn,
    }),

  listSessions: (motsId: string, environment: string, limit = 5) =>
    automationsClient.get<SessionSummary[]>(`${BASE}/sessions`, {
      params: { mots_id: motsId, environment, limit },
    }),

  getRuntimeValues: (motsId: string, environment: string) =>
    automationsClient.get<Record<string, unknown>>(
      `${BASE}/app-catalog/${motsId}/runtime-values/${environment}`
    ),

  // Config management
  listConfigVersions: (configType: string) =>
    automationsClient.get<ConfigVersion[]>(`${BASE}/config/${configType}`),

  getConfigVersion: (configType: string, version: string) =>
    automationsClient.get<ConfigVersion>(`${BASE}/config/${configType}/${version}`),

  createConfigVersion: (configType: string, payload: CreateConfigVersionPayload) =>
    automationsClient.post<ConfigVersion>(`${BASE}/config/${configType}`, payload),

  updateConfigVersion: (configType: string, version: string, payload: UpdateConfigVersionPayload) =>
    automationsClient.put<ConfigVersion>(`${BASE}/config/${configType}/${version}`, payload),

  activateConfigVersion: (configType: string, version: string) =>
    automationsClient.put<ConfigVersion>(`${BASE}/config/${configType}/${version}/activate`),

  deleteConfigVersion: (configType: string, version: string) =>
    automationsClient.delete(`${BASE}/config/${configType}/${version}`),

  checkRepoExists: (motsId: string) =>
    automationsClient.get<RepoCheckResponse>(`/repo-generator/itap/${motsId}/check`),

  getRepoFormData: (itap: string) =>
    automationsClient.get<RepoFormDataResponse>(`/repo-generator/itap/${itap}/form-data`),

  createRepo: (payload: RepoCreatePayload) =>
    automationsClient.post<RepoCreateResponse>('/repo-generator/create', payload),

  uploadScript: (motsId: string, environment: string, scriptType: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('environment', environment)
    formData.append('script_type', scriptType)
    return automationsClient.post<{ s3_uri: string }>(
      `${BASE}/app-catalog/${motsId}/upload-script`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
  },
}
