import React from 'react'
import Alert from '@cloudscape-design/components/alert'
import Box from '@cloudscape-design/components/box'
import Button from '@cloudscape-design/components/button'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  errorMessage: string
}

/**
 * Shared ErrorBoundary component using Cloudscape design system.
 * Catches rendering errors in child components and displays a user-friendly fallback.
 */
export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message || 'An unexpected error occurred' }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: '' })
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box padding="l">
          <Alert
            type="error"
            header="Something went wrong"
            action={
              <Button onClick={this.handleRetry}>Try Again</Button>
            }
          >
            {this.state.errorMessage}
          </Alert>
        </Box>
      )
    }
    return this.props.children
  }
}
