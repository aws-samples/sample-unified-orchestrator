import { createContext, useContext, useState, type ReactNode } from 'react'

interface MoveGroupsCacheValue {
  lastClustering: unknown
  lastPartition: unknown
  setLastClustering: (v: unknown) => void
  setLastPartition: (v: unknown) => void
}

const MoveGroupsCacheContext = createContext<MoveGroupsCacheValue | null>(null)

export function MoveGroupsCacheProvider({ children }: { children: ReactNode }) {
  const [lastClustering, setLastClustering] = useState<unknown>(null)
  const [lastPartition, setLastPartition] = useState<unknown>(null)
  return (
    <MoveGroupsCacheContext.Provider
      value={{
        lastClustering,
        lastPartition,
        setLastClustering,
        setLastPartition,
      }}
    >
      {children}
    </MoveGroupsCacheContext.Provider>
  )
}

export function useMoveGroupsCache() {
  const ctx = useContext(MoveGroupsCacheContext)
  if (!ctx) {
    throw new Error('useMoveGroupsCache must be used within MoveGroupsCacheProvider')
  }
  return ctx
}
