import { Tabs, TabsProps } from '@cloudscape-design/components'
import { useNavigate } from 'react-router-dom'

interface TabNavigationProps {
  activeTab: string
}

export default function TabNavigation({ activeTab }: TabNavigationProps) {
  const navigate = useNavigate()

  const tabs: TabsProps.Tab[] = [
    {
      id: 'portfolio',
      label: 'Portfolio Overview',
    },
    {
      id: 'priorities',
      label: 'Migration Priorities',
    },
    {
      id: 'patterns',
      label: 'Pattern Matching',
    },
    {
      id: 'planning',
      label: 'Wave Planning',
    },
    {
      id: 'move-groups',
      label: 'Move Groups',
    },
  ]

  const handleTabChange = ({ detail }: { detail: TabsProps.ChangeDetail }) => {
    const tabId = detail.activeTabId

    // Navigate to corresponding route
    switch (tabId) {
      case 'portfolio':
        navigate('/wave-planner/portfolio')
        break
      case 'priorities':
        navigate('/wave-planner/priorities')
        break
      case 'patterns':
        navigate('/wave-planner/patterns')
        break
      case 'move-groups':
        navigate('/wave-planner/move-groups')
        break
      case 'planning':
        navigate('/wave-planner/planning')
        break
    }
  }

  return (
    <Tabs
      activeTabId={activeTab}
      onChange={handleTabChange}
      tabs={tabs}
      variant="default"
    />
  )
}
