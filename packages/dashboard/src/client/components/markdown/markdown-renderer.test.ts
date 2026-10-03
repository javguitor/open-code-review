import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, it, expect, vi } from 'vitest'

// The real renderer pulls in mermaid (~2MB) and browser-only providers.
vi.mock('./mermaid-renderer', () => ({
  default: (props: { securityLevel?: string }) =>
    createElement('figure', { 'data-mermaid-stub': props.securityLevel }),
}))

import { MarkdownRenderer, getMermaidSource } from './markdown-renderer'

function render(content: string): string {
  return renderToStaticMarkup(createElement(MarkdownRenderer, { content }))
}

const DIAGRAM = ['```mermaid', 'sequenceDiagram', '  User->>App: asks', '```'].join('\n')

describe('MarkdownRenderer — mermaid code blocks', () => {
  // The first render only starts the lazy import (Suspense fallback); once it
  // settles, the stub renders. Warm up so every test sees the settled state.
  beforeAll(async () => {
    render(DIAGRAM)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('routes a ```mermaid block to the lazy diagram renderer', () => {
    const html = render(`## What This Change Does\n\n${DIAGRAM}\n`)
    expect(html).toContain('data-mermaid-stub="strict"')
    expect(html).not.toContain('<pre')
  })

  it('keeps other fenced blocks as plain code', () => {
    const html = render('```ts\nconst a = 1\n```\n')
    expect(html).toContain('<pre')
    expect(html).not.toContain('data-mermaid-stub')
  })

  it('renders prose around the diagram unchanged', () => {
    const html = render(`**What the task asks**\n\nSomething.\n\n${DIAGRAM}\n\n## Verdict\n`)
    expect(html).toContain('What the task asks')
    expect(html).toContain('Verdict')
    expect(html).toContain('data-mermaid-stub')
  })
})

describe('getMermaidSource', () => {
  it('returns null for an empty mermaid block', () => {
    const child = createElement('code', { className: 'language-mermaid' }, '  \n')
    expect(getMermaidSource(child)).toBeNull()
  })

  it('returns the trimmed source of a mermaid block', () => {
    const child = createElement('code', { className: 'language-mermaid' }, 'flowchart TD\n  A-->B\n')
    expect(getMermaidSource(child)).toBe('flowchart TD\n  A-->B')
  })

  it('ignores other languages', () => {
    const child = createElement('code', { className: 'hljs language-ts' }, 'x')
    expect(getMermaidSource(child)).toBeNull()
  })
})
