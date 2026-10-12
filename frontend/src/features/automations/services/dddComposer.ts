import automationsClient from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DddExecution {
  execution_id: string
  automation_type: string
  itap_id: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  created_at: string | null
  started_at: string | null
  completed_at: string | null
  input_s3_path: string | null
  output_s3_path: string | null
  output_metadata: Record<string, unknown> | null
  error_message: string | null
  step_function_arn: string | null
}

export interface StartGenerationResponse {
  execution_id: string
  status: string
}

export interface ExecutionListResponse {
  executions: DddExecution[]
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const dddComposerApi = {
  startGeneration: (itapId: string, files: File[]) => {
    const formData = new FormData()
    formData.append('automation_type', 'ddd-builder')
    formData.append('itap_id', itapId)
    files.forEach((f) => formData.append('files', f))
    return automationsClient.post<StartGenerationResponse>('/execute', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getExecutionStatus: (executionId: string) =>
    automationsClient.get<DddExecution>(`/executions/${executionId}`),

  listExecutions: (itapId: string) =>
    automationsClient.get<ExecutionListResponse>('/executions', {
      params: { itap_id: itapId, type: 'ddd-builder' },
    }),

  downloadDocument: (executionId: string) =>
    automationsClient.get(`/executions/${executionId}/download`, {
      responseType: 'blob',
    }),
}
