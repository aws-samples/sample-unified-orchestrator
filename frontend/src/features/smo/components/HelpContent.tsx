import HelpPanel from '@cloudscape-design/components/help-panel'
import Box from '@cloudscape-design/components/box'
import SpaceBetween from '@cloudscape-design/components/space-between'

type HelpContext = 'general' | 'create' | 'jobs' | 'accounts'

interface HelpContentProps {
    context?: HelpContext
}

interface HelpEntry {
    title: string
    body: string
    tips: string[]
}

const HELP_CONTENT: Record<HelpContext, HelpEntry> = {
    create: {
        title: 'Creating Sync Jobs',
        body: 'Configure and submit storage sync jobs using Express or Advanced mode.',
        tips: [
            'Express mode: Search by MOTSID to auto-populate source/target servers and paths.',
            'Advanced mode: Manually configure source host, target instance, paths, and credentials.',
            'Select the correct OS — Windows uses robocopy, Linux/Unix uses rsync.',
            'Credential ARN points to your SSH key or username/password in Secrets Manager or Parameter Store.',
            'Use bandwidth limits to avoid saturating network links during business hours.',
        ],
    },
    jobs: {
        title: 'Managing Sync Jobs',
        body: 'View, filter, and manage your sync jobs from the Active Jobs table.',
        tips: [
            'Use the filter bar to search by Status, Job Name, Tags, or Account.',
            'Click a job name to edit it inline.',
            'Logs: View live SSM command output for running jobs.',
            'Delta Check: Compare source and target after a completed sync.',
            'Clone: Copy job settings into the Advanced form for quick re-creation.',
            'Retry: Re-run a failed or cancelled job with the same configuration.',
            'Status meanings: Pending → Queued → Running → Completed/Failed.',
        ],
    },
    accounts: {
        title: 'Cross-Account Configuration',
        body: 'Register external AWS accounts to enable cross-account storage sync.',
        tips: [
            'Each account needs an alias, account ID, and external ID for the IAM trust policy.',
            'The cross-account role name defaults to StorageSyncCrossAccountRole.',
            'After registration, apply the generated trust policy to the IAM role in the target account.',
            'Credentials (SSH keys) for cross-account jobs should be stored in the target account.',
        ],
    },
    general: {
        title: 'Storage Migration Orchestrator',
        body: 'A web-based tool for orchestrating file system migrations between on-premises servers and AWS EC2 instances.',
        tips: [
            'Use the top navigation bar to toggle dark/light mode and access your user menu.',
            'The stats bar shows a quick summary of total, active, completed, and failed jobs.',
            'Download Template and Bulk Sync (CSV) buttons are in the action bar above the form.',
            'Manage Accounts opens the cross-account registry for multi-account deployments.',
            'Scheduled Jobs tab shows configured recurring and one-time sync schedules.',
        ],
    },
}

export default function HelpContent({ context = 'general' }: HelpContentProps) {
    const content = HELP_CONTENT[context] ?? HELP_CONTENT.general

    return (
        <HelpPanel header={<h2>{content.title}</h2>}>
            <SpaceBetween size="m">
                <Box variant="p">{content.body}</Box>
                <Box variant="h4">Tips</Box>
                <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                    {content.tips.map((tip, i) => (
                        <li key={i} style={{ marginBottom: '0.5em' }}>
                            <Box variant="small">{tip}</Box>
                        </li>
                    ))}
                </ul>
            </SpaceBetween>
        </HelpPanel>
    )
}
