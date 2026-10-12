import { Button, Spinner, StatusIndicator, Box } from '@cloudscape-design/components'

interface SessionIndicatorProps {
  state: 'generating' | 'review' | 'approved' | 'publishing' | 'published' | 'error'
  environment: string
  motsId: string
  showEnvironmentPrefix: boolean
  onNavigate: (motsId: string, environment: string) => void
}

export default function SessionIndicator({
  state,
  environment,
  motsId,
  showEnvironmentPrefix,
  onNavigate,
}: SessionIndicatorProps) {
  const prefix = showEnvironmentPrefix ? `${environment}: ` : ''

  const handleClick = () => {
    onNavigate(motsId, environment)
  }

  switch (state) {
    case 'generating':
      return (
        <Button variant="inline-link" onClick={handleClick}>
          <Box display="inline-block" margin={{ right: 'xxs' }}>
            <Spinner size="normal" />
          </Box>
          {prefix}Generating…
        </Button>
      )

    case 'review':
      return (
        <Button variant="inline-link" onClick={handleClick}>
          {prefix}Review Code
        </Button>
      )

    case 'approved':
      return (
        <Button variant="inline-link" onClick={handleClick}>
          <StatusIndicator type="success">{prefix}Approved</StatusIndicator>
        </Button>
      )

    case 'publishing':
      return (
        <Button variant="inline-link" onClick={handleClick}>
          <Box display="inline-block" margin={{ right: 'xxs' }}>
            <Spinner size="normal" />
          </Box>
          {prefix}Publishing PR…
        </Button>
      )

    case 'published':
      return (
        <Button variant="inline-link" onClick={handleClick}>
          <StatusIndicator type="success">{prefix}Published</StatusIndicator>
        </Button>
      )

    case 'error':
      return (
        <Button variant="inline-link" onClick={handleClick}>
          <StatusIndicator type="error">{prefix}Error</StatusIndicator>
        </Button>
      )
  }
}
