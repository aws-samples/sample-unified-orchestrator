import { useState, useEffect } from 'react'
import Modal from '@cloudscape-design/components/modal'
import Table from '@cloudscape-design/components/table'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import FormField from '@cloudscape-design/components/form-field'
import Input from '@cloudscape-design/components/input'
import Header from '@cloudscape-design/components/header'
import StatusIndicator from '@cloudscape-design/components/status-indicator'
import Alert from '@cloudscape-design/components/alert'
import ColumnLayout from '@cloudscape-design/components/column-layout'
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard'
import { useAccounts } from '../hooks/useAccounts'
import BulkAccountImport from './BulkAccountImport'
import type { Account } from '../services/api'

interface AccountManagerProps {
    visible: boolean
    onDismiss: () => void
}

/**
 * Cross-account registry management modal.
 * Shows registered accounts table with status and role access columns,
 * a registration form with trust policy output, and bulk CSV import.
 */
export default function AccountManager({ visible, onDismiss }: AccountManagerProps) {
    const {
        accounts, loading, error, refreshAccounts,
        registerAccount, deactivateAccount, reactivateAccount,
        deleteAccount, verifyAccountRole,
    } = useAccounts()

    const [accountId, setAccountId] = useState('')
    const [alias, setAlias] = useState('')
    const [externalId, setExternalId] = useState('')
    const [secretsManagerEndpointUrl, setSecretsManagerEndpointUrl] = useState('')
    const [roleName, setRoleName] = useState('')
    const [registering, setRegistering] = useState(false)
    const [registerError, setRegisterError] = useState<string | null>(null)
    const [trustPolicy, setTrustPolicy] = useState<string | null>(null)

    // Clear stale state when modal opens
    useEffect(() => {
        if (visible) {
            setTrustPolicy(null)
            setRegisterError(null)
        }
    }, [visible])

    function generateExternalId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        let id = ''
        for (let i = 0; i < 32; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setExternalId(id)
    }

    function buildTrustPolicyPreview(acctId: string, extId: string): string {
        const policy = {
            Version: '2012-10-17',
            Statement: [{
                Effect: 'Allow',
                Principal: { AWS: `arn:aws:iam::${acctId}:root` },
                Action: 'sts:AssumeRole',
                ...(extId && { Condition: { StringEquals: { 'sts:ExternalId': extId } } }),
            }],
        }
        return JSON.stringify(policy, null, 2)
    }

    async function handleRegister() {
        if (!accountId.trim() || !alias.trim()) return
        setRegistering(true)
        setRegisterError(null)
        setTrustPolicy(null)
        try {
            const result = await registerAccount({
                targetAccountId: accountId.trim(),
                alias: alias.trim(),
                externalId: externalId.trim(),
                secretsManagerEndpointUrl: secretsManagerEndpointUrl.trim(),
                ...(roleName.trim() && { crossAccountRoleName: roleName.trim() }),
            })
            if (result?.trustPolicy) {
                setTrustPolicy(result.trustPolicy)
            } else {
                setTrustPolicy(buildTrustPolicyPreview(accountId.trim(), externalId.trim()))
            }
            if (result?.roleWarning) {
                setRegisterError(result.roleWarning)
            }
            setAccountId('')
            setAlias('')
            setExternalId('')
            setSecretsManagerEndpointUrl('')
            setRoleName('')
        } catch (err) {
            setRegisterError(err instanceof Error ? err.message : 'Failed to register account')
        } finally {
            setRegistering(false)
        }
    }

    async function handleDeactivate(id: string) {
        try {
            await deactivateAccount(id)
        } catch (err) {
            setRegisterError(err instanceof Error ? err.message : 'Failed to deactivate account')
        }
    }

    async function handleReactivate(id: string) {
        try {
            await reactivateAccount(id)
        } catch (err) {
            setRegisterError(err instanceof Error ? err.message : 'Failed to reactivate account')
        }
    }

    async function handleDelete(id: string) {
        try {
            await deleteAccount(id)
        } catch (err) {
            setRegisterError(err instanceof Error ? err.message : 'Failed to delete account')
        }
    }

    async function handleVerifyRole(id: string) {
        try {
            await verifyAccountRole(id)
        } catch (err) {
            setRegisterError(err instanceof Error ? err.message : 'Failed to verify role')
        }
    }

    const columnDefinitions = [
        {
            id: 'alias',
            header: 'Alias',
            cell: (item: Account) => item.alias || '—',
            sortingField: 'alias',
        },
        {
            id: 'accountId',
            header: 'Account ID',
            cell: (item: Account) => item.maskedAccountId || item.accountId || '—',
        },
        {
            id: 'roleName',
            header: 'Role Name',
            cell: (item: Account) => item.crossAccountRoleName || 'StorageSyncCrossAccountRole',
        },
        {
            id: 'status',
            header: 'Status',
            cell: (item: Account) => {
                if (item.status === 'inactive') return <StatusIndicator type="stopped">Inactive</StatusIndicator>
                return <StatusIndicator type="success">Active</StatusIndicator>
            },
        },
        {
            id: 'roleStatus',
            header: 'Role Access',
            cell: (item: Account) => {
                const rs = item.roleStatus || 'unverified'
                const lastAttempt = item.lastVerificationAttempt
                const timeAgo = lastAttempt ? new Date(lastAttempt).toLocaleDateString() : null
                if (rs === 'verified') {
                    return (
                        <SpaceBetween direction="horizontal" size="xs">
                            <StatusIndicator type="success">Verified</StatusIndicator>
                            {timeAgo && <Box variant="small" color="text-body-secondary">{timeAgo}</Box>}
                        </SpaceBetween>
                    )
                }
                return (
                    <SpaceBetween direction="horizontal" size="xs">
                        <StatusIndicator type={rs === 'failed' ? 'error' : 'stopped'}>
                            {rs === 'failed' ? 'Failed' : 'Unverified'}
                        </StatusIndicator>
                        {timeAgo && <Box variant="small" color="text-body-secondary">{timeAgo}</Box>}
                        <Button variant="inline-link" onClick={() => handleVerifyRole(item.accountId)}>
                            Verify
                        </Button>
                    </SpaceBetween>
                )
            },
        },
        {
            id: 'actions',
            header: 'Actions',
            minWidth: 180,
            cell: (item: Account) => {
                if (item.status === 'inactive') {
                    return (
                        <SpaceBetween direction="horizontal" size="xs">
                            <Button variant="inline-link" onClick={() => handleReactivate(item.accountId)}>
                                Reactivate
                            </Button>
                            <Button variant="inline-link" onClick={() => handleDelete(item.accountId)}>
                                Delete
                            </Button>
                        </SpaceBetween>
                    )
                }
                return (
                    <Button variant="inline-link" onClick={() => handleDeactivate(item.accountId)}>
                        Deactivate
                    </Button>
                )
            },
        },
    ]

    return (
        <Modal
            visible={visible}
            onDismiss={onDismiss}
            size="large"
            header="External Target Accounts"
            footer={
                <Box float="right">
                    <Button variant="link" onClick={onDismiss}>Close</Button>
                </Box>
            }
        >
            <SpaceBetween size="l">
                {error && (
                    <Alert type="error" dismissible onDismiss={() => { /* hook manages error state */ }}>
                        {error}
                    </Alert>
                )}
                {registerError && (
                    <Alert type="error" dismissible onDismiss={() => setRegisterError(null)}>
                        {registerError}
                    </Alert>
                )}

                <Table
                    columnDefinitions={columnDefinitions}
                    items={accounts}
                    loading={loading}
                    loadingText="Loading accounts..."
                    header={
                        <Header
                            counter={`(${accounts.length})`}
                            actions={
                                <Button iconName="refresh" ariaLabel="Refresh accounts" onClick={refreshAccounts} />
                            }
                        >
                            Registered Accounts
                        </Header>
                    }
                    empty={
                        <Box textAlign="center" color="inherit" padding="l">
                            <b>No external accounts</b>
                            <Box variant="p" color="inherit">
                                Register a target account below to enable cross-account sync.
                            </Box>
                        </Box>
                    }
                    ariaLabels={{ tableLabel: 'External target accounts table' }}
                />

                {/* Registration form */}
                <Header variant="h3">Register Account</Header>
                <ColumnLayout columns={2}>
                    <FormField label="Account Alias" constraintText="Friendly name for this account">
                        <Input
                            value={alias}
                            onChange={({ detail }) => setAlias(detail.value)}
                            placeholder="e.g. prod-target"
                            ariaLabel="Account alias"
                        />
                    </FormField>
                    <FormField label="Account ID" constraintText="12-digit AWS account ID">
                        <Input
                            value={accountId}
                            onChange={({ detail }) => setAccountId(detail.value)}
                            placeholder="123456789012"
                            ariaLabel="Account ID"
                        />
                    </FormField>
                    <FormField label="External ID" constraintText="Used in IAM trust policy condition">
                        <SpaceBetween direction="horizontal" size="xs">
                            <Input
                                value={externalId}
                                onChange={({ detail }) => setExternalId(detail.value)}
                                placeholder="Auto-generate or enter manually"
                                ariaLabel="External ID"
                            />
                            <Button onClick={generateExternalId} iconName="refresh" ariaLabel="Generate External ID">
                                Generate
                            </Button>
                        </SpaceBetween>
                    </FormField>
                    <FormField label="Cross-Account Role Name" constraintText="Optional IAM role name in target account">
                        <Input
                            value={roleName}
                            onChange={({ detail }) => setRoleName(detail.value)}
                            placeholder="e.g. StorageSyncCrossAccountRole"
                            ariaLabel="Cross-account role name"
                        />
                    </FormField>
                    <FormField
                        label="Secrets Manager Endpoint URL"
                        description="Generate via the customer's self-service portal. Example: https://vpce-<id>-<hash>.secretsmanager.<region>.vpce.amazonaws.com"
                    >
                        <Input
                            value={secretsManagerEndpointUrl}
                            onChange={({ detail }) => setSecretsManagerEndpointUrl(detail.value)}
                            placeholder="https://vpce-<id>-<hash>.secretsmanager.<region>.vpce.amazonaws.com"
                            ariaLabel="Secrets Manager Endpoint URL"
                        />
                    </FormField>
                </ColumnLayout>
                <Button
                    onClick={handleRegister}
                    loading={registering}
                    disabled={!accountId.trim() || !alias.trim() || !externalId.trim()}
                    variant="primary"
                >
                    Register Account
                </Button>

                {/* Trust policy output after registration */}
                {trustPolicy && (
                    <Alert type="success" header="Account registered — Trust Policy">
                        <SpaceBetween size="xs">
                            <Box variant="p">
                                Apply this trust policy to the IAM role in the target account:
                            </Box>
                            <Box>
                                <pre style={{ fontSize: '0.85em', whiteSpace: 'pre-wrap', margin: 0 }}>
                                    {trustPolicy}
                                </pre>
                            </Box>
                            <CopyToClipboard
                                copyButtonAriaLabel="Copy trust policy"
                                copySuccessText="Copied"
                                copyErrorText="Failed to copy"
                                textToCopy={trustPolicy}
                                variant="inline"
                            />
                        </SpaceBetween>
                    </Alert>
                )}

                {/* Bulk account registration via CSV */}
                <BulkAccountImport
                    onRegister={registerAccount}
                    onRefresh={refreshAccounts}
                />
            </SpaceBetween>
        </Modal>
    )
}
