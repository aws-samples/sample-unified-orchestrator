import { useState } from 'react'
import Table from '@cloudscape-design/components/table'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'
import Button from '@cloudscape-design/components/button'
import Input from '@cloudscape-design/components/input'
import Header from '@cloudscape-design/components/header'
import Container from '@cloudscape-design/components/container'
import Alert from '@cloudscape-design/components/alert'
import FormField from '@cloudscape-design/components/form-field'
import type { InventoryServer, InventorySearchResult } from '../services/api'
import { searchInventory } from '../services/api'

interface InventorySearchProps {
    onSelect: (server: InventoryServer) => void
}

export default function InventorySearch({ onSelect }: InventorySearchProps) {
    const [motsId, setMotsId] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [results, setResults] = useState<InventorySearchResult | null>(null)

    async function handleSearch() {
        const trimmed = motsId.trim()
        if (!trimmed) return
        setLoading(true)
        setError(null)
        setResults(null)
        try {
            const data = await searchInventory(trimmed)
            setResults(data)
        } catch (err) {
            setError((err as Error).message || 'Failed to search inventory')
        } finally {
            setLoading(false)
        }
    }

    function handleKeyDown({ detail }: { detail: { key: string } }) {
        if (detail.key === 'Enter') handleSearch()
    }

    const items: InventoryServer[] = [
        ...(results?.sources ?? []),
        ...(results?.targets ?? []),
    ]

    const columnDefinitions = [
        {
            id: 'serverName',
            header: 'Hostname',
            cell: (item: InventoryServer) => item.serverName || '—',
            sortingField: 'serverName',
        },
        {
            id: 'hostIp',
            header: 'IP Address',
            cell: (item: InventoryServer) => item.hostIp || '—',
        },
        {
            id: 'os',
            header: 'OS',
            cell: (item: InventoryServer) => item.operatingSystem || '—',
        },
        {
            id: 'instanceId',
            header: 'Instance ID',
            cell: (item: InventoryServer) => item.instanceId || item.targetInstanceId || '—',
        },
        {
            id: 'accountId',
            header: 'Account',
            cell: (item: InventoryServer) => item.accountId || '—',
        },
    ]

    return (
        <Container
            header={
                <Header variant="h2" description="Search for servers by MOTSID">
                    Inventory Search
                </Header>
            }
        >
            <SpaceBetween size="l">
                <SpaceBetween direction="horizontal" size="xs" alignItems="end">
                    <FormField label="MOTSID">
                        <Input
                            value={motsId}
                            onChange={({ detail }) => setMotsId(detail.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter MOTSID"
                            ariaLabel="MOTSID search input"
                        />
                    </FormField>
                    <Button
                        onClick={handleSearch}
                        loading={loading}
                        disabled={!motsId.trim()}
                        iconName="search"
                    >
                        Search
                    </Button>
                </SpaceBetween>

                {error && (
                    <Alert type="error" dismissible onDismiss={() => setError(null)}>
                        {error}
                    </Alert>
                )}

                {results && (
                    <Table
                        columnDefinitions={columnDefinitions}
                        items={items}
                        loading={loading}
                        onRowClick={({ detail }) => onSelect(detail.item)}
                        header={
                            <Header counter={`(${items.length})`}>
                                Search Results
                            </Header>
                        }
                        empty={
                            <Box textAlign="center" color="inherit" padding="l">
                                <b>No servers found</b>
                                <Box variant="p" color="inherit">
                                    No inventory records match the provided MOTSID.
                                </Box>
                            </Box>
                        }
                        ariaLabels={{ tableLabel: 'Inventory search results table' }}
                    />
                )}

                {!results && !loading && !error && (
                    <Box textAlign="center" color="text-body-secondary" padding="l">
                        Enter a MOTSID above to search the inventory.
                    </Box>
                )}
            </SpaceBetween>
        </Container>
    )
}
