import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../../features/uno/contexts/AuthContext'
import { getCurrentUser } from '../services/api'
import { resolvePermissions } from '../services/rbac'
import type { SmoRole, SmoUserInfo } from '../services/api'
import type { UiSection } from '../services/rbac'

export interface UseSmoAuthReturn {
    smoRole: SmoRole | null
    smoUser: SmoUserInfo | null
    loading: boolean
    visibleSections: UiSection[]
    canCreateJob: boolean
    canDeleteJob: boolean
    canManageAccounts: boolean
    canBulkImport: boolean
    canManageSchedules: boolean
    isAccountAuthorized: (alias: string) => boolean
}

export function useSmoAuth(): UseSmoAuthReturn {
    useAuth() // keep AuthProvider dependency
    const [smoUser, setSmoUser] = useState<SmoUserInfo | null>(null)
    const [smoRole, setSmoRole] = useState<SmoRole | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false

        getCurrentUser()
            .then((user) => {
                if (cancelled) return
                setSmoUser(user)
                setSmoRole(user.role)
            })
            .catch(() => {
                // /auth/me failed — fall back to UNO persona mapping
                if (cancelled) return
                setSmoUser(null)
                setSmoRole(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    const permissions = resolvePermissions(false, smoRole)

    const isAccountAuthorized = useCallback(
        (alias: string): boolean => {
            if (!smoUser) return false
            if (smoUser.authorizedAccounts === '*') return true
            return smoUser.authorizedAccounts.some((a) => a.alias === alias)
        },
        [smoUser]
    )

    return {
        smoRole,
        smoUser,
        loading,
        visibleSections: permissions.visibleSections,
        canCreateJob: permissions.canCreateJob,
        canDeleteJob: permissions.canDeleteJob,
        canManageAccounts: permissions.canManageAccounts,
        canBulkImport: permissions.canBulkImport,
        canManageSchedules: permissions.canManageSchedules,
        isAccountAuthorized,
    }
}
