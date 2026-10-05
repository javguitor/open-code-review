import { describe, it, expect } from 'vitest'
import { removeMermaidTempNodes } from './mermaid-cleanup'

describe('removeMermaidTempNodes', () => {
  it('removes both the d-prefixed container and the bare element', () => {
    const removed: string[] = []
    const doc = {
      getElementById: (id: string) => ({ remove: () => void removed.push(id) }),
    }
    removeMermaidTempNodes(doc, 'mermaid_r0')
    expect(removed).toEqual(['dmermaid_r0', 'mermaid_r0'])
  })

  it('is a no-op when the nodes are absent', () => {
    expect(() => removeMermaidTempNodes({ getElementById: () => null }, 'x')).not.toThrow()
  })
})
