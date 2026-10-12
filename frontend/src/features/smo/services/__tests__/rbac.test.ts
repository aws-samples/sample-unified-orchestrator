import { describe, it, expect } from 'vitest'
import {
    ROLES,
    ACTIONS,
    SUPER_ADMIN,
    MIGRATION_ADMIN,
    MIGRATION_ENGINEER,
    getVisibleSections,
    isActionAllowed,
    resolvePermissions,
} from '../rbac'
import type { UiSection } from '../rbac'
import type { SmoRole } from '../api'

describe('rbac', () => {
    describe('role constants', () => {
        it('exports correct role values', () => {
            expect(SUPER_ADMIN).toBe('SuperAdmin')
            expect(MIGRATION_ADMIN).toBe('MigrationAdmin')
            expect(MIGRATION_ENGINEER).toBe('MigrationEngineer')
            expect(ROLES.SUPER_ADMIN).toBe('SuperAdmin')
            expect(ROLES.MIGRATION_ADMIN).toBe('MigrationAdmin')
            expect(ROLES.MIGRATION_ENGINEER).toBe('MigrationEngineer')
        })
    })

    describe('getVisibleSections', () => {
        it('returns all 8 sections for SuperAdmin', () => {
            const sections = getVisibleSections('SuperAdmin')
            expect(sections).toHaveLength(8)
            expect(sections).toEqual([
                'jobTable', 'createJob', 'accountManager', 'bulkImport',
                'schedules', 'liveOutput', 'deltaCheck', 'inventorySearch',
            ])
        })

        it('returns all sections except accountManager for MigrationAdmin', () => {
            const sections = getVisibleSections('MigrationAdmin')
            expect(sections).toHaveLength(7)
            expect(sections).not.toContain('accountManager')
            expect(sections).toContain('jobTable')
            expect(sections).toContain('createJob')
        })

        it('returns only jobTable and liveOutput for MigrationEngineer', () => {
            const sections = getVisibleSections('MigrationEngineer')
            expect(sections).toEqual(['jobTable', 'liveOutput'])
        })
    })

    describe('isActionAllowed', () => {
        it('SuperAdmin can perform all actions', () => {
            for (const action of Object.values(ACTIONS)) {
                expect(isActionAllowed('SuperAdmin', action)).toBe(true)
            }
        })

        it('MigrationAdmin can perform all actions except manageAccounts', () => {
            expect(isActionAllowed('MigrationAdmin', ACTIONS.CREATE_JOB)).toBe(true)
            expect(isActionAllowed('MigrationAdmin', ACTIONS.DELETE_JOB)).toBe(true)
            expect(isActionAllowed('MigrationAdmin', ACTIONS.EDIT_JOB)).toBe(true)
            expect(isActionAllowed('MigrationAdmin', ACTIONS.VIEW_JOBS)).toBe(true)
            expect(isActionAllowed('MigrationAdmin', ACTIONS.MANAGE_SCHEDULES)).toBe(true)
            expect(isActionAllowed('MigrationAdmin', ACTIONS.BULK_IMPORT)).toBe(true)
            expect(isActionAllowed('MigrationAdmin', ACTIONS.MANAGE_ACCOUNTS)).toBe(false)
        })

        it('MigrationEngineer can only view jobs', () => {
            expect(isActionAllowed('MigrationEngineer', ACTIONS.VIEW_JOBS)).toBe(true)
            expect(isActionAllowed('MigrationEngineer', ACTIONS.CREATE_JOB)).toBe(false)
            expect(isActionAllowed('MigrationEngineer', ACTIONS.DELETE_JOB)).toBe(false)
            expect(isActionAllowed('MigrationEngineer', ACTIONS.MANAGE_ACCOUNTS)).toBe(false)
        })

        it('returns false for unknown actions', () => {
            expect(isActionAllowed('SuperAdmin', 'unknownAction')).toBe(false)
        })
    })

    describe('resolvePermissions', () => {
        it('viewer + SuperAdmin: all write permissions false, SuperAdmin sections', () => {
            const perms = resolvePermissions(true, 'SuperAdmin')
            expect(perms.canCreateJob).toBe(false)
            expect(perms.canDeleteJob).toBe(false)
            expect(perms.canManageAccounts).toBe(false)
            expect(perms.canBulkImport).toBe(false)
            expect(perms.canManageSchedules).toBe(false)
            expect(perms.visibleSections).toHaveLength(8)
        })

        it('viewer + MigrationAdmin: all write permissions false', () => {
            const perms = resolvePermissions(true, 'MigrationAdmin')
            expect(perms.canCreateJob).toBe(false)
            expect(perms.canDeleteJob).toBe(false)
            expect(perms.canManageAccounts).toBe(false)
            expect(perms.canBulkImport).toBe(false)
            expect(perms.canManageSchedules).toBe(false)
        })

        it('viewer + null smoRole: read-only with MigrationEngineer sections', () => {
            const perms = resolvePermissions(true, null)
            expect(perms.canCreateJob).toBe(false)
            expect(perms.canDeleteJob).toBe(false)
            expect(perms.canManageAccounts).toBe(false)
            expect(perms.visibleSections).toEqual(['jobTable', 'liveOutput'])
        })

        it('privileged + null smoRole: MigrationAdmin equivalent', () => {
            const perms = resolvePermissions(false, null)
            expect(perms.canCreateJob).toBe(true)
            expect(perms.canDeleteJob).toBe(true)
            expect(perms.canManageAccounts).toBe(false)
            expect(perms.canBulkImport).toBe(true)
            expect(perms.canManageSchedules).toBe(true)
            expect(perms.visibleSections).toHaveLength(7)
            expect(perms.visibleSections).not.toContain('accountManager')
        })

        it('privileged + SuperAdmin: full permissions', () => {
            const perms = resolvePermissions(false, 'SuperAdmin')
            expect(perms.canCreateJob).toBe(true)
            expect(perms.canDeleteJob).toBe(true)
            expect(perms.canManageAccounts).toBe(true)
            expect(perms.canBulkImport).toBe(true)
            expect(perms.canManageSchedules).toBe(true)
            expect(perms.visibleSections).toHaveLength(8)
        })

        it('privileged + MigrationAdmin: no account management', () => {
            const perms = resolvePermissions(false, 'MigrationAdmin')
            expect(perms.canCreateJob).toBe(true)
            expect(perms.canDeleteJob).toBe(true)
            expect(perms.canManageAccounts).toBe(false)
            expect(perms.canBulkImport).toBe(true)
            expect(perms.canManageSchedules).toBe(true)
        })

        it('privileged + MigrationEngineer: view only', () => {
            const perms = resolvePermissions(false, 'MigrationEngineer')
            expect(perms.canCreateJob).toBe(false)
            expect(perms.canDeleteJob).toBe(false)
            expect(perms.canManageAccounts).toBe(false)
            expect(perms.canBulkImport).toBe(false)
            expect(perms.canManageSchedules).toBe(false)
            expect(perms.visibleSections).toEqual(['jobTable', 'liveOutput'])
        })

        // RBAC superset property: higher-privilege roles see a superset of sections
        it('SuperAdmin sections are a superset of MigrationAdmin sections', () => {
            const superAdminSections = new Set(getVisibleSections('SuperAdmin'))
            const adminSections = getVisibleSections('MigrationAdmin')
            for (const section of adminSections) {
                expect(superAdminSections.has(section)).toBe(true)
            }
        })

        it('MigrationAdmin sections are a superset of MigrationEngineer sections', () => {
            const adminSections = new Set(getVisibleSections('MigrationAdmin'))
            const engineerSections = getVisibleSections('MigrationEngineer')
            for (const section of engineerSections) {
                expect(adminSections.has(section)).toBe(true)
            }
        })
    })
})
