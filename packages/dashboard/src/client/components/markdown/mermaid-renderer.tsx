import { useEffect, useRef, useState, useId } from 'react'
import mermaid from 'mermaid'
import { useT } from '../../lib/i18n'
import { useTheme } from '../../providers/theme-provider'
import { removeMermaidTempNodes } from './mermaid-cleanup'

type MermaidRendererProps = {
  definition: string
  onNodeClick?: (nodeId: string) => void
  /**
   * Mermaid security level. `'loose'` enables click handlers and HTML labels
   * (the review map needs them); `'strict'` sanitizes the diagram and disables
   * click directives — use it for any content derived from untrusted text.
   */
  securityLevel?: 'strict' | 'loose'
}

/**
 * Renders a Mermaid definition string as SVG.
 * This component must be lazy-loaded via React.lazy() since mermaid is ~2MB.
 */
export default function MermaidRenderer({
  definition,
  onNodeClick,
  securityLevel = 'strict',
}: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const { t } = useT()
  const { resolved: theme } = useTheme()
  const uniqueId = useId().replace(/:/g, '_')

  // Re-initialize mermaid only when the theme changes (not on every definition change)
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel,
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
      },
    })
  }, [theme, securityLevel])

  useEffect(() => {
    if (!definition || !containerRef.current) return

    let cancelled = false

    // Event delegation handler for node clicks — added once to the container
    // so it is automatically cleaned up without tracking per-node listeners.
    function handleContainerClick(e: MouseEvent) {
      if (!onNodeClick) return
      const target = (e.target as HTMLElement).closest('.node') as HTMLElement | null
      if (!target) return
      const nodeId = target.id?.replace(/^flowchart-/, '').replace(/-\d+$/, '') ?? ''
      if (nodeId) onNodeClick(nodeId)
    }

    async function render() {
      setError(null)

      try {
        if (cancelled) return

        // Validate first: parse() throws the real syntax message without touching
        // the DOM, unlike render(), which leaves its error SVG in <body>.
        await mermaid.parse(definition)
        if (cancelled) return

        const elementId = `mermaid${uniqueId}`
        let svg: string
        try {
          ;({ svg } = await mermaid.render(elementId, definition))
        } catch (renderErr) {
          removeMermaidTempNodes(document, elementId)
          throw renderErr
        }

        if (cancelled || !containerRef.current) return

        containerRef.current.innerHTML = svg

        // Style clickable nodes for UX
        if (onNodeClick) {
          const nodes = containerRef.current.querySelectorAll('.node')
          nodes.forEach((node) => {
            ;(node as HTMLElement).style.cursor = 'pointer'
          })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('map.render_diagram_failed'))
        }
      }
    }

    const container = containerRef.current
    if (onNodeClick) {
      container.addEventListener('click', handleContainerClick)
    }

    render()
    return () => {
      cancelled = true
      container.removeEventListener('click', handleContainerClick)
    }
  }, [definition, theme, uniqueId, onNodeClick, t])

  if (error) {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          {t('common.diagram_render_failed', { error })}
        </div>
        {/* Keep the source visible so a broken diagram never hides content. */}
        <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <code>{definition}</code>
        </pre>
      </div>
    )
  }

  return <div ref={containerRef} className="overflow-x-auto [&_svg]:max-w-full" />
}
