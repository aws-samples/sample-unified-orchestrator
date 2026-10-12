/**
 * Re-export shared ErrorBoundary for backward compatibility.
 * New code should import directly from '@/shared/components/ErrorBoundary'.
 */
import SharedErrorBoundary from '../../../../shared/components/ErrorBoundary'

export { SharedErrorBoundary as ErrorBoundary }
export default SharedErrorBoundary
