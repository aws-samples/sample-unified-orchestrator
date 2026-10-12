import { ReactNode, useState } from 'react'
import { AppLayout, TopNavigation } from '@cloudscape-design/components'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import { Mode } from '@cloudscape-design/global-styles'
import Navigation from './Navigation'

interface MainLayoutProps {
  children: ReactNode
}

export default function MainLayout({ children }: MainLayoutProps) {
  const [navigationOpen, setNavigationOpen] = useState(true)
  const { mode, toggleMode } = useTheme()
  const { user, isAuthenticated, logout } = useAuth()

  return (
    <>
      <TopNavigation
        identity={{
          href: '/',
          title: 'Unified Orchestrator',
          logo: {
            src: '',
            alt: 'Unified Orchestrator',
          },
        }}
        utilities={[
          {
            type: 'button',
            text: 'Documentation',
            href: '#',
            external: true,
            externalIconAriaLabel: '(opens in new tab)',
          },
          {
            type: 'button',
            iconName: mode === Mode.Light ? 'view-full' : 'view-vertical',
            text: mode === Mode.Light ? 'Dark mode' : 'Light mode',
            onClick: toggleMode,
          },
          ...(isAuthenticated
            ? [
              {
                type: 'menu-dropdown' as const,
                text: user?.display_name || 'User',
                description: `${user?.groups?.[0] || user?.persona || ''} · ${user?.email || ''}`,
                iconName: 'user-profile' as const,
                items: [
                  { id: 'profile', text: 'Profile' },
                  { id: 'preferences', text: 'Preferences' },
                  { id: 'signout', text: 'Sign out' },
                ],
                onItemClick: ({ detail }: { detail: { id: string } }) => {
                  if (detail.id === 'signout') {
                    logout()
                  }
                },
              },
            ]
            : []),
        ]}
      />
      <AppLayout
        navigationOpen={navigationOpen}
        onNavigationChange={({ detail }) => setNavigationOpen(detail.open)}
        navigation={<Navigation />}
        content={children}
        toolsHide
        headerSelector="#top-navigation"
        ariaLabels={{
          navigation: 'Side navigation',
          navigationClose: 'Close side navigation',
          navigationToggle: 'Open side navigation',
        }}
      />
    </>
  )
}
