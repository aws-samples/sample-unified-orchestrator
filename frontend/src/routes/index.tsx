import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Spinner } from '@cloudscape-design/components'
import ProtectedRoute from '../features/uno/components/common/ProtectedRoute'
import HomePage from '../features/uno/pages/HomePage'
import PodsPage from '../features/uno/pages/PodsPage'
import RiskPage from '../features/ara/pages/RiskPage'
import HistoryPage from '../features/ara/pages/HistoryPage'
import WaveAnalysisSetupPage from '../features/ara/pages/WaveAnalysisSetupPage'
import WaveAnalysisResultsPage from '../features/ara/pages/WaveAnalysisResultsPage'
import LoginPage from '../features/uno/pages/LoginPage'
import CallbackPage from '../features/uno/pages/CallbackPage'
import NotesPage from '../features/uno/pages/NotesPage'
import NotFoundPage from '../features/uno/pages/NotFoundPage'
import ATXWorkbenchPage from '../features/ara/pages/ATXWorkbenchPage'
import WavePlannerLayout from '../features/pam/pages/WavePlanner/WavePlannerLayout'
import PortfolioOverview from '../features/pam/pages/WavePlanner/PortfolioOverview'
import MigrationPriorities from '../features/pam/pages/WavePlanner/MigrationPriorities'
import PatternMatching from '../features/pam/pages/WavePlanner/PatternMatching'
import MoveGroups from '../features/pam/pages/WavePlanner/MoveGroups'
import WavePlannerPage from '../features/pam/pages/WavePlanner'
import ApplicationDetailPage from '../features/pam/pages/WavePlanner/ApplicationDetailPage'
import { ROUTES } from '../features/automations/constants'
import AppInputPage from '../features/automations/pages/iac-agent/AppInputPage'

const BlueprintCatalogPage = lazy(() => import('../features/automations/pages/BlueprintCatalogPage'))
const AppCompositionsPage = lazy(() => import('../features/automations/pages/AppCompositionsPage'))
const EditCompositionPage = lazy(() => import('../features/automations/pages/EditCompositionPage'))
const TerraformComposerPage = lazy(() => import('../features/automations/pages/iac-agent/TerraformComposerPage'))
const SessionHistoryPage = lazy(() => import('../features/automations/pages/iac-agent/SessionHistoryPage'))
const AgentSettingsPage = lazy(() => import('../features/automations/pages/iac-agent/AgentSettingsPage'))
const DddComposerPage = lazy(() => import('../features/automations/pages/ddd-composer/DddComposerPage'))
const AdsGeneratorPage = lazy(() => import('../features/automations/pages/ads-generator/AdsGeneratorPage'))
// bootkare edit — SMO integration
import StorageDashboardPage from '../features/smo/pages/StorageDashboardPage'
// DMO integration — Database Migration Orchestrator dashboard
const DatabaseMigrationDashboardPage = lazy(
  () => import('../features/dmo/pages/DatabaseMigrationDashboardPage')
)

function P({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

export default function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/callback" element={<CallbackPage />} />

      {/* Protected routes */}
      <Route path="/" element={<P><HomePage /></P>} />
      <Route path="/pods" element={<P><PodsPage /></P>} />
      <Route path="/pods/:id" element={<P><PodsPage /></P>} />
      <Route path="/risk" element={<P><RiskPage /></P>} />
      <Route path="/risk/history" element={<P><HistoryPage /></P>} />
      <Route path="/patterns" element={<P><WaveAnalysisSetupPage /></P>} />
      <Route path="/patterns/results/:waveId" element={<P><WaveAnalysisResultsPage /></P>} />
      <Route path="/patterns/history" element={<P><HistoryPage /></P>} />
      <Route path="/notes" element={<P><NotesPage /></P>} />
      <Route path="/atx-workbench" element={<P><ATXWorkbenchPage /></P>} />
      <Route path={ROUTES.APP_INPUT} element={<P><AppInputPage /></P>} />
      <Route path={ROUTES.BLUEPRINTS} element={<P><Suspense fallback={<Spinner />}><BlueprintCatalogPage /></Suspense></P>} />
      <Route path={ROUTES.COMPOSITIONS} element={<P><Suspense fallback={<Spinner />}><AppCompositionsPage /></Suspense></P>} />
      <Route path={`${ROUTES.COMPOSITIONS}/:motsId/edit`} element={<P><Suspense fallback={<Spinner />}><EditCompositionPage /></Suspense></P>} />
      <Route path={ROUTES.COMPOSER} element={<P><Suspense fallback={<Spinner />}><TerraformComposerPage /></Suspense></P>} />
      <Route path={ROUTES.SESSION_HISTORY} element={<P><Suspense fallback={<Spinner />}><SessionHistoryPage /></Suspense></P>} />
      <Route path={ROUTES.AGENT_SETTINGS} element={<P><Suspense fallback={<Spinner />}><AgentSettingsPage /></Suspense></P>} />
      <Route path={ROUTES.DDD_COMPOSER} element={<P><Suspense fallback={<Spinner />}><DddComposerPage /></Suspense></P>} />
      <Route path={ROUTES.ADS_GENERATOR} element={<P><Suspense fallback={<Spinner />}><AdsGeneratorPage /></Suspense></P>} />

      {/* Wave Planner routes */}
      <Route path="/wave-planner" element={<P><WavePlannerLayout /></P>}>
        <Route index element={<PortfolioOverview />} />
        <Route path="portfolio" element={<PortfolioOverview />} />
        <Route path="priorities" element={<MigrationPriorities />} />
        <Route path="patterns" element={<PatternMatching />} />
        <Route path="move-groups" element={<MoveGroups />} />
        <Route path="planning" element={<WavePlannerPage />} />
      </Route>
      <Route path="/wave-planner/applications/:motsId" element={<P><ApplicationDetailPage /></P>} />

      {/* bootkare edit — SMO Storage Migration Orchestrator */}
      <Route path="/orchestration/storage" element={<P><StorageDashboardPage /></P>} />

      {/* DMO — Database Migration Orchestrator */}
      <Route
        path="/orchestration/dbmigration"
        element={<P><Suspense fallback={<Spinner />}><DatabaseMigrationDashboardPage /></Suspense></P>}
      />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
