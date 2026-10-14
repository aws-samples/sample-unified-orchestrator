import apiClient from '../../uno/services/api'

// Matches the new backend transformation-based response
export interface Transformation {
    transformation_id: string
    type: string        // UPGRADE, MODERNIZE, NO_CHANGE, GENERIC_MIGRATE
    complexity: string  // CRITICAL, HIGH, MEDIUM, LOW
    component_count: number
    machine_count: number
    application_count: number
    description: string
    source: { publisher: string; product: string; version: string; category: string }
    target: { publisher: string; product: string; version: string; category: string }
    manual_review_required: boolean
}

export interface PatternStatistics {
    total_unique_patterns: number
    total_component_migrations: number
    high_complexity_count: number
    critical_complexity_count: number
    manual_review_required: number
    total_applications: number
    assessed_applications: number
    pending_assessments: number
}

export interface WavePatternsResponse {
    success: boolean
    wave_id: string
    transformations: Transformation[]
    statistics: PatternStatistics
    transformation_types: Record<string, number>
    complexity_distribution: Record<string, number>
    count: number
    warnings_count?: number
    error?: string
    message?: string
}

/**
 * Get transformation patterns for a specific wave
 */
export const getWavePatterns = async (
    waveId: string,
    options?: {
        type?: string
        complexity?: string
        search?: string
        useCache?: boolean
    }
): Promise<WavePatternsResponse> => {
    const response = await apiClient.get(`/ara/wave/${waveId}/patterns`, {
        params: {
            type: options?.type,
            complexity: options?.complexity,
            search: options?.search,
            use_cache: options?.useCache ?? true,
        },
    })
    return response.data
}

/**
 * Type labels for display
 */
export const TYPE_LABELS: Record<string, string> = {
    UPGRADE: 'Upgrade',
    MODERNIZE: 'Modernize',
    NO_CHANGE: 'No Change',
    GENERIC_MIGRATE: 'Generic Migration',
}

/**
 * Complexity badge color
 */
export const getComplexityColor = (level: string) => {
    switch (level) {
        case 'CRITICAL': return 'red'
        case 'HIGH': return 'severity-high'
        case 'MEDIUM': return 'severity-medium'
        case 'LOW': return 'severity-low'
        default: return 'blue'
    }
}

/**
 * Type badge color
 */
export const getTypeColor = (type: string) => {
    switch (type) {
        case 'UPGRADE': return 'blue'
        case 'MODERNIZE': return 'green'
        case 'NO_CHANGE': return 'grey'
        case 'GENERIC_MIGRATE': return 'red'
        default: return 'blue'
    }
}

// ============================================================================
// New Wave Pattern Analysis API (Independent from Risk Assessment)
// ============================================================================

export interface VersionChange {
    publisher: string
    product: string
    category: string
    sub_category: string
    current_version: string
    target_version: string
}

export interface ApplicationInfo {
    app_id: string
    app_name: string
    description?: string  // Human-readable summary of changes
    change_count: number
    similarity?: number
    is_exact_match?: boolean
    variations?: string[]
}

export interface ComplexityScore {
    score: number
    level: string  // Low, Medium, High
    factors: {
        change_count?: number
        category_count?: number
        application_count?: number
        change_score?: number
        category_score?: number
        impact_score?: number
        total_changes?: number
        average_changes_per_app?: number
    }
}

export interface ComponentPattern {
    pattern_id: string
    pattern_state: string  // HAS_CHANGES, NO_CHANGES_NEEDED, NO_TARGET_VERSIONS
    pattern_signature: string
    human_name: string
    description?: string  // Human-readable summary of changes
    migration_strategy: string
    application_count: number
    similarity_range?: [number, number]
    common_changes: VersionChange[]
    applications: ApplicationInfo[]
    complexity_score: ComplexityScore
}

export interface StrategyPattern {
    strategy: string
    application_count: number
    applications: Array<{
        app_id: string
        app_name: string
        pattern_id: string
        human_name: string
        description?: string  // Human-readable summary of changes
        change_count: number
    }>
    complexity_score: ComplexityScore
}

// Legacy type for backward compatibility
export interface PatternGroup extends ComponentPattern {
    version_changes: VersionChange[]
}

export interface ExecutiveSummary {
    wave_id: string
    total_applications: number
    applications_analyzed: number
    unique_patterns: number
    applications_with_patterns: number
    applications_without_patterns: number
    applications_no_migration_needed: number
    analysis_timestamp: string
}

export interface PatternStatisticsNew {
    total_applications: number
    applications_with_patterns: number
    applications_no_changes: number
    applications_no_targets: number
    unique_patterns: number
    total_pattern_groups: number
}

export interface Pattern {
    pattern_id: string
    pattern_state: string
    human_name: string
    description?: string
    pattern_signature: string
    migration_strategy: string
    application_count: number
    applications: Array<{
        app_id: string
        app_name: string
        description?: string
        change_count: number
        total_components: number
    }>
}

export interface WavePatternAnalysisResponse {
    success: boolean
    wave_id: string
    analysis_id?: string
    s3_key?: string
    analysis_timestamp?: string
    executive_summary?: ExecutiveSummary
    patterns?: Pattern[]
    statistics?: PatternStatisticsNew
    recommendations?: string[]
    performance_metrics?: {
        total_time: number
        retriever_time: number
        analysis_time: number
    }
    // Fields for "no eligible applications" response
    message?: string
    total_applications?: number
    analyzed_count?: number
    excluded_count?: number
    exclusion_reasons?: {
        risk_not_started?: number
        wave_already_completed?: number
        atx_already_completed?: number
    }
    error?: string
}

export interface AnalysisMetadata {
    analysis_id: string
    wave_id: string
    s3_key: string
    last_modified: string
    size: number
}

export interface AnalysesListResponse {
    success: boolean
    wave_id: string
    analyses: AnalysisMetadata[]
    count: number
    error?: string
}

/**
 * Run wave pattern analysis for a specific wave
 */
export const runWavePatternAnalysis = async (
    waveId: string,
    similarityThreshold: number = 70
): Promise<WavePatternAnalysisResponse> => {
    const response = await apiClient.post(`/ara/patterns/wave/${waveId}/analyze`, {
        similarity_threshold: similarityThreshold
    })
    return response.data
}

/**
 * Get wave pattern analysis results (latest or specific)
 */
export const getWavePatternAnalysis = async (
    waveId: string,
    analysisId?: string
): Promise<WavePatternAnalysisResponse> => {
    const response = await apiClient.get(`/ara/patterns/wave/${waveId}/analysis`, {
        params: analysisId ? { analysis_id: analysisId } : undefined
    })
    return response.data.analysis || response.data
}

/**
 * List all wave pattern analyses for a wave
 */
export const listWavePatternAnalyses = async (waveId: string): Promise<AnalysesListResponse> => {
    const response = await apiClient.get(`/ara/patterns/wave/${waveId}/analyses`)
    return response.data
}


/**
 * Get wave pattern analysis report (HTML or JSON)
 */
export const getWavePatternAnalysisReport = async (
    waveId: string,
    analysisId: string,
    format: 'html' | 'json' = 'html',
    download: boolean = false
): Promise<string> => {
    const response = await apiClient.get(
        `/ara/patterns/wave/${waveId}/analysis/${analysisId}/report`,
        {
            params: { format, download: download ? 'true' : 'false' },
            responseType: format === 'html' ? 'text' : 'json'
        }
    )
    return format === 'html' ? response.data : JSON.stringify(response.data, null, 2)
}


// ============================================================================
// ATX Transformation Mapping API
// ============================================================================

export interface ATXTransformation {
    name: string
    description: string
    version: string
}

export interface ATXTransformationsResponse {
    success: boolean
    transformations: ATXTransformation[]
    file_key?: string
    last_modified?: string
    count: number
    error?: string
}

export interface ATXMapping {
    pattern_id: string
    application_id: string
    application_name: string
    strategy: string
    transformation_instructions: string
    atx_name: string
    atx_description: string
}

export interface ATXMappingsSubmitRequest {
    mappings: ATXMapping[]
}

export interface ATXMappingsSubmitResponse {
    success: boolean
    updated_count?: number
    message?: string
    errors?: string[]
    error?: string
}

/**
 * Get available ATX transformations from uploaded ATX file
 */
export const getATXTransformations = async (): Promise<ATXTransformationsResponse> => {
    const response = await apiClient.get('/ara/patterns/atx/transformations')
    return response.data
}

/**
 * Get existing ATX mappings for a wave
 */
export const getATXMappings = async (waveId: string): Promise<{
    success: boolean
    wave_id: string
    mappings: ATXMapping[]
    count: number
    error?: string
}> => {
    const response = await apiClient.get(`/ara/patterns/wave/${waveId}/atx-mappings`)
    return response.data
}

/**
 * Submit ATX transformation mappings for a wave
 */
export const submitATXMappings = async (
    waveId: string,
    mappings: ATXMapping[]
): Promise<ATXMappingsSubmitResponse> => {
    const response = await apiClient.post(`/ara/patterns/wave/${waveId}/atx-mappings`, {
        mappings
    })
    return response.data
}
