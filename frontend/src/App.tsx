import { BrowserRouter as Router } from 'react-router-dom'
import { AuthProvider } from './features/uno/contexts/AuthContext'
import { AppProvider } from './features/uno/contexts/AppContext'
import { ToolsPanelProvider } from './features/uno/contexts/ToolsPanelContext'
import MainLayout from './features/uno/components/common/MainLayout'
import AppRoutes from './routes'

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppProvider>
          <ToolsPanelProvider>
            <MainLayout>
              <AppRoutes />
            </MainLayout>
          </ToolsPanelProvider>
        </AppProvider>
      </AuthProvider>
    </Router>
  )
}

export default App
