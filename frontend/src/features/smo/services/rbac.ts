import type { SmoRole } from './api'

// ── Role Constants ──

export const SUPER_ADMIN = 'SuperAdmin' as const
export const MIGRATION_ADMIN = 'MigrationAdmin' as const
export const MIGRATION_ENGINEER = 'MigrationEngineer' as const

export const ROLES = {
    SUPER_ADMIN,
    MIGRATION_ADMIN,
    MIGRATION_ENGINEER,
} as const

// ── Actions ──

export const ACTIONS = {
    MANAGE_ACCOUNTS: 'manageAccounts',
    CREATE_JOB: 'createJob',
    DELETE_JOB: 'deleteJob',
    EDIT_JOB: 'editJob',
    VIEW_JOBS: 'viewJobs',
    MANAGE_SCHEDULES: 'manageSchedules',
    BULK_IMPORT: 'bulkImport',
} as const

export type Action = typeof ACTIONS[keyof typeof ACTIONS]

// ── UI Sections ──

export type UiSection =
    | 'jobTable'
    | 'createJob'
    | 'accountManager'
    | 'bulkImport'
    | 'schedules'
    | 'liveOutput'
    | 'deltaCheck'
    | 'inventorySearch'

// ── Permission Matrix ──

const ROLE_PERMISSIONS: Record<SmoRole, Set<Action>> = {
    [SUPER_ADMIN]: new Set(Object.values(ACTIONS)),
    [MIGRATION_ADMIN]: new Set([
        ACTIONS.MANAGE_ACCOUNTS,
        ACTIONS.CREATE_JOB,
        ACTIONS.DELETE_JOB,
        ACTIONS.EDIT_JOB,
        ACTIONS.VIEW_JOBS,
        ACTIONS.MANAGE_SCHEDULES,
        ACTIONS.BULK_IMPORT,
    ]),
    [MIGRATION_ENGINEER]: new Set([
        ACTIONS.CREATE_JOB,
        ACTIONS.DELETE_JOB,
        ACTIONS.EDIT_JOB,
        ACTIONS.VIEW_JOBS,
        ACTIONS.MANAGE_SCHEDULES,
        ACTIONS.BULK_IMPORT,
    ]),
}

// ── Section Visibility ──

const ALL_SECTIONS: UiSection[] = [
    'jobTable', 'createJob', 'accountManager', 'bulkImport',
    'schedules', 'liveOutput', 'deltaCheck', 'inventorySearch',
]

const SECTION_MAP: Record<SmoRole, UiSection[]> = {
    [SUPER_ADMIN]: ALL_SECTIONS,
    [MIGRATION_ADMIN]: ALL_SECTIONS,
    [MIGRATION_ENGINEER]: [
        'jobTable', 'createJob', 'bulkImport',
        'schedules', 'liveOutput', 'deltaCheck', 'inventorySearch',
    ],
}

/**
 * Return the list of visible UI sections for a given SMO role.
 */
export function getVisibleSections(smoRole: SmoRole): UiSection[] {
    return SECTION_MAP[smoRole] ?? []
}

/**
 * Check if a role is allowed to perform a specific action.
 */
export function isActionAllowed(smoRole: SmoRole, action: string): boolean {
    const perms = ROLE_PERMISSIONS[smoRole]
    if (!perms) return false
    return perms.has(action as Action)
}

// ── Permissions Resolution ──

export interface ResolvedPermissions {
    canCreateJob: boolean
    canDeleteJob: boolean
    canManageAccounts: boolean
    canBulkImport: boolean
    canManageSchedules: boolean
    visibleSections: UiSection[]
}

/**
 * Resolve the effective permissions by intersecting the UNO persona
 * with the SMO role.
 *
 * - If `unoIsViewer` is true, all write permissions are false regardless of SMO role.
 * - If `smoRole` is null, fall back to UNO persona mapping:
 *   privileged users get MigrationAdmin-equivalent access,
 *   viewers get read-only access.
 */
export function resolvePermissions(
    unoIsViewer: boolean,
    smoRole: SmoRole | null
): ResolvedPermissions {
    // Viewer override: no write permissions, minimal sections
    if (unoIsViewer && smoRole === null) {
        return {
            canCreateJob: false,
            canDeleteJob: false,
            canManageAccounts: false,
            canBulkImport: false,
            canManageSchedules: false,
            visibleSections: getVisibleSections(MIGRATION_ENGINEER),
        }
    }

    // Authenticated user without SMO role: no access
    if (!unoIsViewer && smoRole === null) {
        return {
            canCreateJob: false,
            canDeleteJob: false,
            canManageAccounts: false,
            canBulkImport: false,
            canManageSchedules: false,
            visibleSections: [],
        }
    }

    // SMO role is known — derive permissions from it
    const role = smoRole as SmoRole
    const visibleSections = getVisibleSections(role)

    // If UNO persona is viewer, strip all write permissions
    if (unoIsViewer) {
        return {
            canCreateJob: false,
            canDeleteJob: false,
            canManageAccounts: false,
            canBulkImport: false,
            canManageSchedules: false,
            visibleSections,
        }
    }

    return {
        canCreateJob: isActionAllowed(role, ACTIONS.CREATE_JOB),
        canDeleteJob: isActionAllowed(role, ACTIONS.DELETE_JOB),
        canManageAccounts: isActionAllowed(role, ACTIONS.MANAGE_ACCOUNTS),
        canBulkImport: isActionAllowed(role, ACTIONS.BULK_IMPORT),
        canManageSchedules: isActionAllowed(role, ACTIONS.MANAGE_SCHEDULES),
        visibleSections,
    }
}
