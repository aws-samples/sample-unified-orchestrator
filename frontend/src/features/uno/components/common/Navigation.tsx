import { SideNavigation, SideNavigationProps } from '@cloudscape-design/components'
import { useLocation, useNavigate } from 'react-router-dom'
import { ROUTES } from '../../../automations/constants'

export default function Navigation() {
  const location = useLocation()
  const navigate = useNavigate()

  const navItems: SideNavigationProps.Item[] = [
    {
      type: 'link',
      text: 'Dashboard',
      href: '/',
    },
    {
      type: 'section',
      text: 'Wave Planner',
      items: [
        { type: 'link', text: 'Portfolio Overview', href: '/wave-planner/portfolio' },
        { type: 'link', text: 'Migration Priorities', href: '/wave-planner/priorities' },
        { type: 'link', text: 'Pattern Matching', href: '/wave-planner/patterns' },
        { type: 'link', text: 'Wave Planning', href: '/wave-planner/planning' },
        { type: 'link', text: 'Move Groups', href: '/wave-planner/move-groups' },
      ],
    },
    {
      type: 'section',
      text: 'Applications',
      items: [
        { type: 'link', text: 'Assessment', href: '/risk' },
        { type: 'link', text: 'Pattern Analysis', href: '/patterns' },
        { type: 'link', text: 'ATX Workbench', href: '/atx-workbench' },
        { type: 'link', text: 'History', href: '/risk/history' },
      ],
    },
    {
      type: 'section',
      text: 'Orchestration',
      items: [
        {
          type: 'link',
          text: 'API Runner',
          href: '/orchestration/api_runner',
        },
        {
          type: 'link',
          text: 'Tool Runner',
          href: '/orchestration/tool_runner',
        },
        {
          type: 'link',
          text: 'DB Migration Orchestrator',
          href: '/orchestration/dbmigration',
        },
        {
          type: 'link',
          text: 'Storage Migration Orchestrator',
          href: '/orchestration/storage',
        },
      ],
    },
    {
      type: 'section',
      text: 'Automations',
      items: [
        {
          type: 'expandable-link-group',
          text: 'IaC Generator',
          href: '#',
          items: [
            {
              type: 'link',
              text: 'Infra Blueprints',
              href: ROUTES.BLUEPRINTS,
            },
            {
              type: 'link',
              text: 'App Compositions',
              href: ROUTES.COMPOSITIONS,
            },
            {
              type: 'link',
              text: 'Terraform Composer',
              href: ROUTES.COMPOSER,
            },
            {
              type: 'link',
              text: 'Agent Settings',
              href: ROUTES.AGENT_SETTINGS,
            },
          ],
        },
        {
          type: 'expandable-link-group',
          text: 'Document Generator',
          href: '#',
          items: [
            {
              type: 'link',
              text: 'DDD Composer',
              href: ROUTES.DDD_COMPOSER,
            },
            {
              type: 'link',
              text: 'ADS Generator',
              href: ROUTES.ADS_GENERATOR,
            },
          ],
        },
      ],
    },
    {
      type: 'section',
      text: 'Additional Information',
      items: [
        { type: 'link', text: 'Notes', href: '/notes' },
      ],
    },
  ]

  const handleFollow = (event: CustomEvent<SideNavigationProps.FollowDetail>) => {
    event.preventDefault()
    if (event.detail.href && event.detail.href !== '#') {
      navigate(event.detail.href)
    }
  }

  return (
    <div style={{ maxHeight: 'calc(100vh - 56px)', overflowY: 'auto' }}>
      <SideNavigation
        activeHref={location.pathname}
        header={{ text: 'Unified Orchestrator', href: '/' }}
        items={navItems}
        onFollow={handleFollow}
      />
    </div>
  )
}
