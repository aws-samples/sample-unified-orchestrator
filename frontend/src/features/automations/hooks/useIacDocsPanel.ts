import { useEffect } from 'react'
import { createElement } from 'react'
import { useToolsPanel } from '../../uno/contexts/ToolsPanelContext'
import IacDocsPanel from '../components/IacDocsPanel'

/**
 * Registers the IaC documentation sidebar for the lifetime of the calling
 * component.  Call this once at the top of every IaC Generator page so the
 * docs panel appears automatically and is cleaned up on unmount / navigation.
 *
 * @param defaultOpen - Whether the panel should be expanded on mount (default `true`).
 */
export function useIacDocsPanel(defaultOpen = true) {
  const { setToolsPanel, clearToolsPanel } = useToolsPanel()

  useEffect(() => {
    setToolsPanel(createElement(IacDocsPanel), defaultOpen)
    return () => clearToolsPanel()
  }, [setToolsPanel, clearToolsPanel, defaultOpen])
}
