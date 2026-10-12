import { createContext, ReactNode, useCallback, useContext, useState } from 'react'

interface ToolsPanelState {
  /** The ReactNode to render in the AppLayout tools slot. */
  content: ReactNode | null
  /** Whether the panel should be open when first registered. */
  defaultOpen: boolean
}

interface ToolsPanelContextType {
  /** Current tools-panel state (content + default-open preference). */
  panel: ToolsPanelState
  /** Register a tools panel. Pass `defaultOpen = true` to auto-expand it. */
  setToolsPanel: (content: ReactNode | null, defaultOpen?: boolean) => void
  /** Remove the current tools panel (hides the slot entirely). */
  clearToolsPanel: () => void
  /** Whether the panel is currently expanded. */
  toolsOpen: boolean
  /** Manually expand / collapse the panel. */
  setToolsOpen: (open: boolean) => void
}

const ToolsPanelContext = createContext<ToolsPanelContextType | undefined>(undefined)

export function ToolsPanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<ToolsPanelState>({ content: null, defaultOpen: false })
  const [toolsOpen, setToolsOpen] = useState(false)

  const setToolsPanel = useCallback((content: ReactNode | null, defaultOpen = false) => {
    setPanel({ content, defaultOpen })
    setToolsOpen(defaultOpen)
  }, [])

  const clearToolsPanel = useCallback(() => {
    setPanel({ content: null, defaultOpen: false })
    setToolsOpen(false)
  }, [])

  return (
    <ToolsPanelContext.Provider value={{ panel, setToolsPanel, clearToolsPanel, toolsOpen, setToolsOpen }}>
      {children}
    </ToolsPanelContext.Provider>
  )
}

export function useToolsPanel() {
  const context = useContext(ToolsPanelContext)
  if (context === undefined) {
    throw new Error('useToolsPanel must be used within a ToolsPanelProvider')
  }
  return context
}
