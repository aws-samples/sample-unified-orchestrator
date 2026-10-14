import { useState } from 'react'
import { ContentLayout, Header, Tabs } from '@cloudscape-design/components'
import AssessmentHistoryTab from '../components/risk/AssessmentHistoryTab'
import PatternHistoryTab from '../components/patterns/PatternHistoryTab'
import ATXHistoryTab from '../components/risk/ATXHistoryTab'

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState('assessment')

  return (
    <ContentLayout header={<Header variant="h1" description="View past assessment, pattern analysis, and ATX workbench runs">History</Header>}>
      <Tabs
        activeTabId={activeTab}
        onChange={({ detail }) => setActiveTab(detail.activeTabId)}
        tabs={[
          { id: 'assessment', label: 'Assessment History', content: <AssessmentHistoryTab appId="" /> },
          { id: 'pattern', label: 'Pattern History', content: <PatternHistoryTab /> },
          { id: 'atx', label: 'ATX Workbench', content: <ATXHistoryTab /> },
        ]}
      />
    </ContentLayout>
  )
}
