type ElementLookup = {
  getElementById: (id: string) => { remove: () => void } | null
}

/**
 * `mermaid.render()` appends a temp container (`d${id}`, holding the
 * "Syntax error" bomb SVG) to `document.body` and does not remove it when it
 * throws. Without this cleanup the leftovers pile up for the life of the SPA tab.
 */
export function removeMermaidTempNodes(doc: ElementLookup, elementId: string): void {
  doc.getElementById(`d${elementId}`)?.remove()
  doc.getElementById(elementId)?.remove()
}
