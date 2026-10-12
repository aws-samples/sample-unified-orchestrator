import ColumnLayout from '@cloudscape-design/components/column-layout'
import Container from '@cloudscape-design/components/container'
import Box from '@cloudscape-design/components/box'
import type { SyncJob } from '../services/api'

interface JobStatsProps {
    jobs: SyncJob[]
}

export default function JobStats({ jobs = [] }: JobStatsProps) {
    const total = jobs.length
    const active = jobs.filter((j) =>
        ['RUNNING', 'PROCESSING', 'PENDING', 'QUEUED'].includes(j.status)
    ).length
    const completed = jobs.filter((j) =>
        ['COMPLETED', 'SUCCESS'].includes(j.status)
    ).length
    const failed = jobs.filter((j) =>
        ['FAILED', 'ERROR', 'TIMED_OUT'].includes(j.status)
    ).length

    return (
        <ColumnLayout columns={4} variant="text-grid">
            <Container>
                <Box variant="awsui-key-label" fontSize="body-s">Total Jobs</Box>
                <Box fontSize="heading-xl" fontWeight="bold">{total}</Box>
            </Container>
            <Container>
                <Box variant="awsui-key-label" fontSize="body-s">Active</Box>
                <Box fontSize="heading-xl" fontWeight="bold" color="text-status-info">{active}</Box>
            </Container>
            <Container>
                <Box variant="awsui-key-label" fontSize="body-s">Completed</Box>
                <Box fontSize="heading-xl" fontWeight="bold" color="text-status-success">{completed}</Box>
            </Container>
            <Container>
                <Box variant="awsui-key-label" fontSize="body-s">Failed</Box>
                <Box fontSize="heading-xl" fontWeight="bold" color="text-status-error">{failed}</Box>
            </Container>
        </ColumnLayout>
    )
}
