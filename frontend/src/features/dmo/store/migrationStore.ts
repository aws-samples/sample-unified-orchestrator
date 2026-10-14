import { create } from 'zustand'

interface MigrationState {
  currentStep: number
  migrationMode: 'single' | 'batch' | 'history'
  source: Record<string, any>
  target: Record<string, any>
  sourceInstanceId: string
  targetInstanceId: string
  sourcePassword: string
  targetPassword: string
  sourceWindowsPassword: string
  targetWindowsPassword: string
  sourcePasswordMethod: 'direct' | 'secretsManager' // pragma: allowlist secret
  targetPasswordMethod: 'direct' | 'secretsManager' // pragma: allowlist secret
  sourceSecretArn: string
  targetSecretArn: string
  configVersion: number
  options: {
    migrationType: string
    databaseType?: string
    physical: {
      backupType: string
      compression: boolean
      checksum: boolean
      copyOnly: boolean
      replaceExisting: boolean
      noRecovery: boolean
      verifyOnly: boolean
    }
    logical: {
      scope: string
      batchSize: number
      parallelThreads: number
      fastMode: boolean
    }
    replication: {
      type: string
      syncInterval: number
      conflictResolution: string
      includeTables: boolean
      includeViews: boolean
      includeStoredProcs: boolean
      includeFunctions: boolean
      enableCompression: boolean
      enableEncryption: boolean
      monitorLatency: boolean
      autoRestart: boolean
    }
    security: {
      users: boolean
      permissions: boolean
    }
    advanced: {
      dropExisting: boolean
      verifyData: boolean
      createBackup: boolean
      dryRun: boolean
    }
  }
  setCurrentStep: (step: number) => void
  setMigrationMode: (mode: 'single' | 'batch' | 'history') => void
  updateSource: (source: Record<string, any>) => void
  updateTarget: (target: Record<string, any>) => void
  updateOptions: (options: any) => void
  setSourceInstanceId: (id: string) => void
  setTargetInstanceId: (id: string) => void
  setSourcePassword: (password: string) => void
  setTargetPassword: (password: string) => void
  setSourceWindowsPassword: (password: string) => void
  setTargetWindowsPassword: (password: string) => void
  setSourcePasswordMethod: (method: 'direct' | 'secretsManager') => void // pragma: allowlist secret
  setTargetPasswordMethod: (method: 'direct' | 'secretsManager') => void // pragma: allowlist secret
  setSourceSecretArn: (arn: string) => void
  setTargetSecretArn: (arn: string) => void
  resetConfig: () => void
  loadConfig: (config: any) => void
}

const defaultOptions = {
  migrationType: 'physical',
  databaseType: 'mysql',
  physical: {
    backupType: 'full',
    compression: true,
    checksum: true,
    copyOnly: false,
    replaceExisting: false,
    noRecovery: false,
    verifyOnly: false,
  },
  logical: {
    scope: 'full',
    batchSize: 1000,
    parallelThreads: 4,
    fastMode: false,
  },
  replication: {
    type: 'transactional',
    syncInterval: 60,
    conflictResolution: 'source-wins',
    includeTables: true,
    includeViews: false,
    includeStoredProcs: false,
    includeFunctions: false,
    enableCompression: true,
    enableEncryption: true,
    monitorLatency: true,
    autoRestart: true,
  },
  security: {
    users: false,
    permissions: false,
  },
  advanced: {
    dropExisting: false,
    verifyData: true,
    createBackup: false,
    dryRun: false,
  },
}

export const useMigrationStore = create<MigrationState>((set) => ({
  currentStep: 1,
  migrationMode: 'single',
  source: {},
  target: {},
  sourceInstanceId: '',
  targetInstanceId: '',
  sourcePassword: '',
  targetPassword: '',
  sourceWindowsPassword: '',
  targetWindowsPassword: '',
  sourcePasswordMethod: 'secretsManager' as const, // pragma: allowlist secret
  targetPasswordMethod: 'secretsManager' as const, // pragma: allowlist secret
  sourceSecretArn: '',
  targetSecretArn: '',
  configVersion: 0,
  options: defaultOptions,

  setCurrentStep: (step) => set({ currentStep: step }),
  setMigrationMode: (mode) => set({ migrationMode: mode }),
  updateSource: (source) => set((state) => ({ source: { ...state.source, ...source } })),
  updateTarget: (target) => set((state) => ({ target: { ...state.target, ...target } })),
  updateOptions: (options) => set((state) => ({ options: { ...state.options, ...options } })),
  setSourceInstanceId: (id) => set({ sourceInstanceId: id }),
  setTargetInstanceId: (id) => set({ targetInstanceId: id }),
  setSourcePassword: (password) => set({ sourcePassword: password }),
  setTargetPassword: (password) => set({ targetPassword: password }),
  setSourceWindowsPassword: (password) => set({ sourceWindowsPassword: password }),
  setTargetWindowsPassword: (password) => set({ targetWindowsPassword: password }),
  setSourcePasswordMethod: (method) => set({ sourcePasswordMethod: method }),
  setTargetPasswordMethod: (method) => set({ targetPasswordMethod: method }),
  setSourceSecretArn: (arn) => set({ sourceSecretArn: arn }),
  setTargetSecretArn: (arn) => set({ targetSecretArn: arn }),

  resetConfig: () =>
    set({
      source: {},
      target: {},
      sourceInstanceId: '',
      targetInstanceId: '',
      sourcePassword: '',
      targetPassword: '',
      sourceWindowsPassword: '',
      targetWindowsPassword: '',
      sourcePasswordMethod: 'direct' as const, // pragma: allowlist secret
      targetPasswordMethod: 'direct' as const, // pragma: allowlist secret
      sourceSecretArn: '',
      targetSecretArn: '',
      options: defaultOptions,
      currentStep: 1,
    }),

  loadConfig: (config) =>
    set({
      source: config.source || {},
      target: config.target || {},
      sourceInstanceId: config.sourceInstanceId || '',
      targetInstanceId: config.targetInstanceId || '',
      sourcePassword: config.sourcePassword || '',
      targetPassword: config.targetPassword || '',
      sourceWindowsPassword: config.sourceWindowsPassword || '',
      targetWindowsPassword: config.targetWindowsPassword || '',
      sourcePasswordMethod: config.sourcePasswordMethod || 'direct', // pragma: allowlist secret
      targetPasswordMethod: config.targetPasswordMethod || 'direct', // pragma: allowlist secret
      sourceSecretArn: config.sourceSecretArn || '',
      targetSecretArn: config.targetSecretArn || '',
      options: config.options || defaultOptions,
      configVersion: Date.now(),
    }),
}))
