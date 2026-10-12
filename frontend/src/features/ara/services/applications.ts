import apiClient from '../../uno/services/api';

export interface ApplicationStatus {
  application_id: string;
  onboarding_status: string;
  risk_assessment_status: string;
  wave_analysis_status: string;
  atx_mapping_status: string;
  timestamps: {
    onboarding_completed_at?: number;
    risk_assessment_started_at?: number;
    risk_assessment_completed_at?: number;
    wave_analysis_started_at?: number;
    wave_analysis_completed_at?: number;
    atx_mapping_assigned_at?: number;
    atx_mapping_completed_at?: number;
  };
}

export interface StatusSummary {
  wave_id: string;
  total_applications: number;
  onboarding: { [status: string]: number };
  risk_assessment: { [status: string]: number };
  wave_analysis: { [status: string]: number };
  atx_mapping: { [status: string]: number };
}

export interface BulkOperationResult {
  success: boolean;
  success_count: number;
  failed_count: number;
  errors: Array<{ application_id: string; error: string }>;
}

/**
 * Get application status
 */
export const getApplicationStatus = async (applicationId: string): Promise<ApplicationStatus> => {
  const response = await apiClient.get(`/ara/applications/${applicationId}/status`);
  return response.data;
};

/**
 * Update application status field
 */
export const updateApplicationStatus = async (
  applicationId: string,
  field: string,
  status: string
): Promise<any> => {
  const response = await apiClient.patch(
    `/ara/applications/${applicationId}/status`,
    { field, status }
  );
  return response.data;
};

/**
 * Clear ATX mapping for an application
 */
export const clearATXMapping = async (applicationId: string): Promise<any> => {
  const response = await apiClient.post(
    `/ara/applications/${applicationId}/clear-atx`
  );
  return response.data;
};

/**
 * Reset completed application
 */
export const resetCompletedApplication = async (applicationId: string): Promise<any> => {
  const response = await apiClient.post(
    `/ara/applications/${applicationId}/reset`
  );
  return response.data;
};

/**
 * Bulk clear ATX mappings
 */
export const bulkClearATXMappings = async (
  applicationIds: string[]
): Promise<BulkOperationResult> => {
  const response = await apiClient.post(
    `/ara/applications/bulk-clear-atx`,
    { application_ids: applicationIds }
  );
  return response.data;
};

/**
 * Bulk mark applications as complete
 */
export const bulkMarkComplete = async (
  applicationIds: string[]
): Promise<BulkOperationResult> => {
  const response = await apiClient.post(
    `/ara/applications/bulk-mark-complete`,
    { application_ids: applicationIds }
  );
  return response.data;
};

/**
 * Bulk reset applications
 */
export const bulkResetApplications = async (
  applicationIds: string[]
): Promise<BulkOperationResult> => {
  const response = await apiClient.post(
    `/ara/applications/bulk-reset`,
    { application_ids: applicationIds }
  );
  return response.data;
};

/**
 * Get wave status summary
 */
export const getWaveStatusSummary = async (waveId: string): Promise<{ success: boolean; summary: StatusSummary }> => {
  const response = await apiClient.get(
    `/wave/${waveId}/applications/status-summary`
  );
  return response.data;
};
