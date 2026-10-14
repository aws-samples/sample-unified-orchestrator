import { useState, useEffect } from 'react'
import Tabs from '@cloudscape-design/components/tabs'
import Container from '@cloudscape-design/components/container'
import Header from '@cloudscape-design/components/header'
import ExpressMode from './ExpressMode'
import AdvancedMode from './AdvancedMode'
import type { CreateJobParams, SyncJob } from '../services/api'

interface CreateJobFormProps {
    onCreateJob: (config: CreateJobParams) => Promise<SyncJob>
    cloneSource?: SyncJob | null
    jobs?: SyncJob[]
}

export default function CreateJobForm({ onCreateJob, cloneSource, jobs }: CreateJobFormProps) {
    const [activeTab, setActiveTab] = useState('advanced')

    useEffect(() => {
        if (cloneSource) setActiveTab('advanced')
    }, [cloneSource])

    return (
        <Container header={<Header variant="h2">Create Sync Job</Header>}>
            <Tabs
                activeTabId={activeTab}
                onChange={({ detail }) => setActiveTab(detail.activeTabId)}
                tabs={[
                    {
                        label: 'Express',
                        id: 'express',
                        content: <ExpressMode onCreateJob={onCreateJob} jobs={jobs} />,
                    },
                    {
                        label: 'Advanced',
                        id: 'advanced',
                        content: <AdvancedMode onCreateJob={onCreateJob} cloneSource={cloneSource} />,
                    },
                ]}
                ariaLabel="Job creation mode"
            />
        </Container>
    )
}
