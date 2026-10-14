import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ContentLayout } from '@cloudscape-design/components'
import TabNavigation from '../../components/wave-planner/TabNavigation'

export default function WavePlannerLayout() {
  const location = useLocation()

  // Determine active tab from current route
  const getActiveTabId = (pathname: string): string => {
    if (pathname.indexOf('/wave-planner/portfolio') !== -1) return 'portfolio'
    if (pathname.indexOf('/wave-planner/priorities') !== -1) return 'priorities'
    if (pathname.indexOf('/wave-planner/patterns') !== -1) return 'patterns'
    if (pathname.indexOf('/wave-planner/move-groups') !== -1) return 'move-groups'
    if (pathname.indexOf('/wave-planner/planning') !== -1) return 'planning'
    return 'portfolio' // default
  }

  const [activeTabId, setActiveTabId] = useState(getActiveTabId(location.pathname))

  // Update active tab when route changes
  useEffect(() => {
    setActiveTabId(getActiveTabId(location.pathname))
  }, [location.pathname])

  return (
    <ContentLayout>
      <TabNavigation activeTab={activeTabId} />
      <div style={{ marginTop: '1rem' }}>
        <Outlet />
      </div>
    </ContentLayout>
  )
}
