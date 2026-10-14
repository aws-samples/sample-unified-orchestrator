/**
 * Constants for the automations module.
 * Centralizes magic strings so changes only need to happen in one place.
 */

/** Known automation identifiers — must match the `automation_id` stored in DynamoDB. */
export const AUTOMATION_IDS = {
  TERRAFORM_AGENT: 'terraform-agent',
} as const

/** API base paths for automation backends. */
export const API_PATHS = {
  IAC_AGENT: '/automations/iac-agent',
  DDD_BUILDER: '/automations',
} as const

/** Frontend route paths for automation pages. */
export const ROUTES = {
  BLUEPRINTS: '/automations/blueprints',
  COMPOSITIONS: '/automations/compositions',
  COMPOSER: '/automations/composer',
  APP_INPUT: '/app-input',
  SESSION_HISTORY: '/automations/session-history',
  AGENT_SETTINGS: '/automations/agent-settings',
  DDD_COMPOSER: '/automations/ddd-composer',
  ADS_GENERATOR: '/automations/ads-generator',
} as const

/** A single documentation link entry. */
export interface DocLink {
  /** Display text for the link */
  text: string
  /** URL the link points to */
  href: string
}

/** Documentation links shown in the IaC Generator help panel. */
export const IAC_DOCS_LINKS: DocLink[] = [
  {
    text: 'BRICS Workflow Structure',
    href: 'https://github.com/ATT-DP5/apm0045263-brics-examples',
  },
  {
    text: 'HCP Terraform Registry',
    href: 'https://app.terraform.io/app/att-ease/registry/private/modules',
  },
]
