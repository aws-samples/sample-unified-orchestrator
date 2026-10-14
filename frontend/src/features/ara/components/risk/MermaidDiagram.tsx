import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import DOMPurify from 'dompurify'
import { Box, StatusIndicator } from '@cloudscape-design/components'

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  suppressErrorRendering: true,
})

interface MermaidDiagramProps {
  chart: string
  title?: string
}

function sanitizeMermaid(raw: string): string {
  let cleaned = raw.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:mermaid)?\n?/, '').replace(/\n?```$/, '')
  }
  cleaned = cleaned.replace(/^["']|["']$/g, '')
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '')
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  cleaned = cleaned.replace(/^\s*\n+/, '')
  cleaned = cleaned.replace(/^(graph)\s*$/m, 'graph TD')
  cleaned = cleaned.replace(/\[([^\]"]*[()][^\]"]*)\]/g, '["$1"]')
  cleaned = cleaned.replace(/;\s*$/gm, '')
  return cleaned.trim()
}

/** Remove any error divs mermaid injects into the DOM */
function cleanupMermaidErrors() {
  document.querySelectorAll('[id^="d"]').forEach((el) => {
    if (el.getAttribute('data-mermaid-error') || el.classList.contains('error')) {
      el.remove()
    }
  })
  // Mermaid v11 appends error SVGs with id matching the render id
  document.querySelectorAll('svg[aria-roledescription="error"]').forEach((el) => el.remove())
  document.querySelectorAll('div[id^="mmd-"]').forEach((el) => {
    if (!el.closest('[data-mermaid-container]')) el.remove()
  })
}

export default function MermaidDiagram({ chart, title }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rendered = useRef(false)

  useEffect(() => {
    if (!chart || rendered.current) return
    rendered.current = true

    const render = async () => {
      const cleaned = sanitizeMermaid(chart)
      if (!cleaned) {
        setError('Empty diagram content')
        return
      }

      // Validate syntax first — parse() doesn't inject DOM elements on failure
      try {
        await mermaid.parse(cleaned)
      } catch {
        setError('Invalid diagram syntax')
        cleanupMermaidErrors()
        return
      }

      try {
        const uniqueId = `mmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const { svg } = await mermaid.render(uniqueId, cleaned)
        setSvgContent(svg)
        setError(null)
      } catch (e: any) {
        setError(e.message || 'Failed to render')
        setSvgContent(null)
      }

      // Always clean up any stray error elements
      cleanupMermaidErrors()
    }
    render()
  }, [chart])

  return (
    <Box padding="s">
      {title && <Box variant="h3" padding={{ bottom: 's' }}>{title}</Box>}
      {error && (
        <Box>
          <StatusIndicator type="warning">Could not render as diagram</StatusIndicator>
          <Box padding={{ top: 's' }}>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px',
              background: '#f8f8f8', padding: '12px', borderRadius: '4px',
              maxHeight: '400px', overflow: 'auto' }}>{chart}</pre>
          </Box>
        </Box>
      )}
      {svgContent && (
        <div
          ref={containerRef}
          data-mermaid-container="true"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svgContent, { USE_PROFILES: { svg: true, svgFilters: true } }) }}
          style={{ overflow: 'auto', maxWidth: '100%' }}
        />
      )}
    </Box>
  )
}
