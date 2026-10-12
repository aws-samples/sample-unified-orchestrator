import automationsClient from './api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdsExecution {
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
  // Name of the Step Function state currently running (e.g. "SynthesizeLambda").
  // Populated only while status === 'RUNNING'; null for terminal states or
  // when the SF GetExecutionHistory call fails. Used by the per-stage stepper.
  current_state?: string | null
}

export interface StartGenerationResponse {
  execution_id: string
  status: string
}

export interface ExecutionListResponse {
  executions: AdsExecution[]
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export const adsGeneratorApi = {
  startGeneration: (itapId: string, files: File[], architectureDiagram?: File | null) => {
    const formData = new FormData()
    formData.append('automation_type', 'ads-builder')
    formData.append('itap_id', itapId)
    files.forEach((f) => formData.append('files', f))
    // Optional: matches the FastAPI form field name in execute_automation().
    // The render Lambda swaps it onto slide 3 of the generated deck.
    if (architectureDiagram) {
      formData.append('architecture_diagram', architectureDiagram)
    }
    return automationsClient.post<StartGenerationResponse>('/execute', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  getExecutionStatus: (executionId: string) =>
    automationsClient.get<AdsExecution>(`/executions/${executionId}`),

  listExecutions: (itapId: string) =>
    automationsClient.get<ExecutionListResponse>('/executions', {
      params: { itap_id: itapId, type: 'ads-builder' },
    }),

  downloadDocument: (executionId: string) =>
    automationsClient.get(`/executions/${executionId}/download`, {
      responseType: 'blob',
    }),
}
