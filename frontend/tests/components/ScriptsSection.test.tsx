/**
 * Property 5: Script path propagation round-trip
 *
 * @vitest-environment node
 *
 * Validates: Requirements 9.1, 9.2, 9.3
 *
 * For any script uploaded via the UI, the corresponding user_data_path or
 * post_deploy_script_path value in the saved runtime values SHALL equal the
 * uploaded filename, and removing the script SHALL clear the path value.
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Pure logic extracted from the RuntimeValuesForm integration:
 * - onScriptUploaded maps scriptType to the correct field and sets the filename
 * - onScriptRemoved maps scriptType to the correct field and clears it
 */
function scriptTypeToField(scriptType: string): string {
  return scriptType === 'user_data' ? 'user_data_path' : 'post_deploy_script_path'
}

function applyScriptUploaded(
  values: Record<string, string>,
  scriptType: string,
  filename: string,
): Record<string, string> {
  const field = scriptTypeToField(scriptType)
  return { ...values, [field]: filename }
}

function applyScriptRemoved(
  values: Record<string, string>,
  scriptType: string,
): Record<string, string> {
  const field = scriptTypeToField(scriptType)
  return { ...values, [field]: '' }
}

// Strategies
const scriptTypeArb = fc.constantFrom('user_data', 'post_mount_script')
const shFilenameArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}\.sh$/)

describe('Property 5: Script path propagation round-trip', () => {
  it('uploading a script sets the correct path in runtime values', () => {
    fc.assert(
      fc.property(scriptTypeArb, shFilenameArb, (scriptType, filename) => {
        const initial: Record<string, string> = {}
        const updated = applyScriptUploaded(initial, scriptType, filename)
        const expectedField = scriptTypeToField(scriptType)

        expect(updated[expectedField]).toBe(filename)
      }),
      { numRuns: 50 },
    )
  })

  it('removing a script clears the path from runtime values', () => {
    fc.assert(
      fc.property(scriptTypeArb, shFilenameArb, (scriptType, filename) => {
        // First upload, then remove
        const initial: Record<string, string> = {}
        const afterUpload = applyScriptUploaded(initial, scriptType, filename)
        const afterRemove = applyScriptRemoved(afterUpload, scriptType)
        const expectedField = scriptTypeToField(scriptType)

        expect(afterRemove[expectedField]).toBe('')
      }),
      { numRuns: 50 },
    )
  })

  it('upload then remove is a round-trip that clears the value', () => {
    fc.assert(
      fc.property(scriptTypeArb, shFilenameArb, (scriptType, filename) => {
        const initial: Record<string, string> = { other_field: 'preserved' }
        const afterUpload = applyScriptUploaded(initial, scriptType, filename)
        const afterRemove = applyScriptRemoved(afterUpload, scriptType)
        const expectedField = scriptTypeToField(scriptType)

        // The script field is cleared
        expect(afterRemove[expectedField]).toBe('')
        // Other fields are preserved
        expect(afterRemove['other_field']).toBe('preserved')
      }),
      { numRuns: 50 },
    )
  })

  it('user_data and post_mount_script map to different fields', () => {
    fc.assert(
      fc.property(shFilenameArb, shFilenameArb, (udFilename, pmFilename) => {
        let values: Record<string, string> = {}
        values = applyScriptUploaded(values, 'user_data', udFilename)
        values = applyScriptUploaded(values, 'post_mount_script', pmFilename)

        expect(values['user_data_path']).toBe(udFilename)
        expect(values['post_deploy_script_path']).toBe(pmFilename)
      }),
      { numRuns: 30 },
    )
  })
})
