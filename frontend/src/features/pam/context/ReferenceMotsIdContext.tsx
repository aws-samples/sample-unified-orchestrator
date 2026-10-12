import { createContext, useContext, useState, type ReactNode } from 'react'
import { DEMO_DEFAULTS } from '../config/demoDefaults'

interface ReferenceMotsIdContextType {
  referenceMotsId: number
  setReferenceMotsId: (id: number) => void
}

const ReferenceMotsIdContext = createContext<ReferenceMotsIdContextType | null>(null)

export function ReferenceMotsIdProvider({ children }: { children: ReactNode }) {
  const [referenceMotsId, setReferenceMotsId] = useState<number>(DEMO_DEFAULTS.referenceMotsId)

  return (
    <ReferenceMotsIdContext.Provider value={{ referenceMotsId, setReferenceMotsId }}>
      {children}
    </ReferenceMotsIdContext.Provider>
  )
}

export function useReferenceMotsId() {
  const context = useContext(ReferenceMotsIdContext)
  if (!context) {
    throw new Error('useReferenceMotsId must be used within a ReferenceMotsIdProvider')
  }
  return context
}
