import { useState, useEffect, useCallback } from 'react'
import {
    listAccounts,
    registerAccount as apiRegisterAccount,
    deactivateAccount as apiDeactivateAccount,
    reactivateAccount as apiReactivateAccount,
    deleteAccount as apiDeleteAccount,
    verifyAccountRole as apiVerifyAccountRole,
} from '../services/api'
import type { Account, RegisterAccountParams } from '../services/api'

export interface UseAccountsReturn {
    accounts: Account[]
    loading: boolean
    error: string | null
    refreshAccounts: () => Promise<void>
    registerAccount: (params: RegisterAccountParams) => Promise<{ trustPolicy?: string; roleWarning?: string }>
    deactivateAccount: (accountId: string) => Promise<void>
    reactivateAccount: (accountId: string) => Promise<void>
    deleteAccount: (accountId: string) => Promise<void>
    verifyAccountRole: (accountId: string) => Promise<void>
}

export function useAccounts(): UseAccountsReturn {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refreshAccounts = useCallback(async () => {
        try {
            const data = await listAccounts()
            setAccounts(Array.isArray(data) ? data : data.accounts ?? [])
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch accounts')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        refreshAccounts()
    }, [refreshAccounts])

    const registerAccount = useCallback(
        async (params: RegisterAccountParams) => {
            const result = await apiRegisterAccount(params)
            await refreshAccounts()
            return result
        },
        [refreshAccounts]
    )

    const deactivateAccount = useCallback(
        async (accountId: string) => {
            await apiDeactivateAccount(accountId)
            await refreshAccounts()
        },
        [refreshAccounts]
    )

    const reactivateAccount = useCallback(
        async (accountId: string) => {
            await apiReactivateAccount(accountId)
            await refreshAccounts()
        },
        [refreshAccounts]
    )

    const deleteAccount = useCallback(
        async (accountId: string) => {
            await apiDeleteAccount(accountId)
            await refreshAccounts()
        },
        [refreshAccounts]
    )

    const verifyAccountRole = useCallback(
        async (accountId: string) => {
            await apiVerifyAccountRole(accountId)
            await refreshAccounts()
        },
        [refreshAccounts]
    )

    return {
        accounts,
        loading,
        error,
        refreshAccounts,
        registerAccount,
        deactivateAccount,
        reactivateAccount,
        deleteAccount,
        verifyAccountRole,
    }
}
