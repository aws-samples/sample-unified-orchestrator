/**
 * Single source of truth for IaC infra repo names.
 * Backend consumes whatever the frontend sends — never reconstructs.
 *
 * Convention: {itap_id}-{app_acronym}-AOP-infra (lowercased).
 * When override is non-empty, it wins verbatim.
 */
export function buildRepoName(
  itapId: string,
  appAcronym: string,
  override?: string
): string {
  const trimmedOverride = (override ?? '').trim()
  if (trimmedOverride) return trimmedOverride
  const itap = itapId.trim().toLowerCase()
  const acronym = appAcronym.trim().toLowerCase()
  if (!itap || !acronym) return ''
  return `${itap}-${acronym}-AOP-infra`
}
