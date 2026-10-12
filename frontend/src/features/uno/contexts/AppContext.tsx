import { createContext, useContext, useState, ReactNode } from 'react'

interface AppContextType {
  loading: boolean
  setLoading: (loading: boolean) => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(false)

  return (
    <AppContext.Provider
      value={{
        loading,
        setLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}
