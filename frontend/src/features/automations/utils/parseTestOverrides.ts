const VALID_CONFIG_TYPES = new Set(['system_prompt', 'brics_workflow'])
const VERSION_PATTERN = /^v\d+$/

/**
 * Parse the test_overrides URL query parameter into a config overrides map.
 *
 * Format: "config_type:version[,config_type:version]"
 * Example: "system_prompt:v3,brics_workflow:v2"
 *
 * Invalid entries are silently dropped. Returns undefined if no valid entries.
 */
export function parseTestOverrides(raw: string | null): Record<string, string> | undefined {
  if (!raw || !raw.trim()) return undefined

  const result: Record<string, string> = {}

  for (const entry of raw.split(',')) {
    const [configType, version] = entry.trim().split(':')
    if (
      configType &&
      version &&
      VALID_CONFIG_TYPES.has(configType) &&
      VERSION_PATTERN.test(version)
    ) {
      result[configType] = version
    }
  }

  return Object.keys(result).length > 0 ? result : undefined
}
