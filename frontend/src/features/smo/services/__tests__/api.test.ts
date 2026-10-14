import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// Mock the shared apiClient before importing the module under test
vi.mock('../../../../features/uno/services/api', () => {
    return {
        default: {
            get: vi.fn().mockResolvedValue({ data: {} }),
            post: vi.fn().mockResolvedValue({ data: {} }),
        },
    }
})

import apiClient from '../../../../features/uno/services/api'
import * as smoApi from '../api'

/**
 * Property 4: SMO API service functions use correct path prefix
 * Validates: Requirements 13.3
 *
 * For any API call function exported from the SMO service module,
 * the request URL path should start with `/smo/` relative to the
 * shared API client base URL.
 */
describe('Property 4: SMO API service functions use correct path prefix', () => {
    // All exported API functions with their call signatures
    const apiFunctions: Array<{ name: string; call: () => Promise<unknown> }> = [
        { name: 'listSyncJobs', call: () => smoApi.listSyncJobs() },
        { name: 'createSyncJob', call: () => smoApi.createSyncJob({ source: '/tmp' }) },
        { name: 'getSyncStatus', call: () => smoApi.getSyncStatus('job-123') },
        { name: 'getSyncLogs', call: () => smoApi.getSyncLogs('job-123') },
        { name: 'getHealth', call: () => smoApi.getHealth() },
        { name: 'getCurrentUser', call: () => smoApi.getCurrentUser() },
        { name: 'listAccounts', call: () => smoApi.listAccounts() },
        { name: 'listSchedules', call: () => smoApi.listSchedules() },
    ]

    beforeEach(() => {
        vi.mocked(apiClient.get).mockClear()
        vi.mocked(apiClient.post).mockClear()
    })

    it('every exported API function calls apiClient with a /smo/ prefixed path', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 0, max: apiFunctions.length - 1 }),
                async (index) => {
                    vi.mocked(apiClient.get).mockClear()
                    vi.mocked(apiClient.post).mockClear()

                    const fn = apiFunctions[index]
                    await fn.call()

                    const getCalls = vi.mocked(apiClient.get).mock.calls
                    const postCalls = vi.mocked(apiClient.post).mock.calls
                    const allPaths = [
                        ...getCalls.map((c) => c[0] as string),
                        ...postCalls.map((c) => c[0] as string),
                    ]

                    expect(allPaths.length).toBeGreaterThan(0)
                    for (const path of allPaths) {
                        expect(path).toMatch(/^\/smo\//)
                    }
                }
            ),
            { numRuns: 100 }
        )
    })
})
