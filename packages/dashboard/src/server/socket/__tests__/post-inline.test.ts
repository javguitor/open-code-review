import { describe, expect, it } from 'vitest'
import {
  buildPreview,
  buildReviewRequest,
  composeBody,
  parseCommentsJson,
  splitComments,
  type PostComment,
} from '../post-inline.js'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,3 +10,4 @@ fn',
  ' ctx10',
  '-gone',
  '+add11',
  '+add12',
  ' ctx13',
  'diff --git a/src/del.ts b/src/del.ts',
  'deleted file mode 100644',
  '--- a/src/del.ts',
  '+++ /dev/null',
  '@@ -1,1 +0,0 @@',
  '-x',
  '',
].join('\n')

const c = (path: string, line: number, extra: Partial<PostComment> = {}): PostComment => ({
  path, line, side: 'RIGHT', severity: 'nit', body: `Nit: ${path}:${line}`, ...extra,
})

describe('parseCommentsJson', () => {
  it('keeps valid entries, normalizes the path and defaults severity', () => {
    const raw = JSON.stringify({ comments: [
      { path: './src/a.ts', line: 11, side: 'RIGHT', severity: 'blocking', body: 'Bloqueante: x' },
      { path: 'src/a.ts', line: 12, body: 'Opcional: y', severity: 'weird' },
      { path: 'src/a.ts', line: 0, body: 'bad line' },
      { path: 'src/a.ts', line: 5, start_line: 5, body: 'empty range' },
      { path: 'src/a.ts', line: 5, body: '  ' },
      'junk',
    ] })
    const out = parseCommentsJson(raw)
    expect(out.map((x) => [x.path, x.line, x.severity])).toEqual([
      ['src/a.ts', 11, 'blocking'],
      ['src/a.ts', 12, 'optional'],
    ])
  })

  it('treats malformed JSON as no comments', () => {
    expect(parseCommentsJson('{nope')).toEqual([])
    expect(parseCommentsJson('{"comments":3}')).toEqual([])
  })
})

describe('splitComments', () => {
  it('keeps added and context lines inline; deleted-only, out-of-hunk and unknown files move', () => {
    const { inline, moved } = splitComments(
      [c('src/a.ts', 10), c('src/a.ts', 11), c('src/a.ts', 13), c('src/a.ts', 14), c('src/a.ts', 3), c('src/del.ts', 1), c('src/other.ts', 1)],
      PATCH,
    )
    expect(inline.map((x) => x.line)).toEqual([10, 11, 13])
    expect(moved.map((x) => `${x.path}:${x.line}`)).toEqual(['src/a.ts:14', 'src/a.ts:3', 'src/del.ts:1', 'src/other.ts:1'])
  })

  it('requires every line of a range to be on the new side', () => {
    const { inline, moved } = splitComments([c('src/a.ts', 12, { start_line: 11 }), c('src/a.ts', 14, { start_line: 12 })], PATCH)
    expect(inline).toHaveLength(1)
    expect(moved).toHaveLength(1)
  })

  it('moves everything when inline is off or there is no patch', () => {
    expect(splitComments([c('src/a.ts', 11)], PATCH, false).inline).toEqual([])
    expect(splitComments([c('src/a.ts', 11)], null).moved).toHaveLength(1)
  })
})

describe('composeBody', () => {
  it('appends moved comments under a localized heading', () => {
    const moved = [c('src/a.ts', 3), c('src/a.ts', 14, { start_line: 12 })]
    expect(composeBody('Resumen', moved, 'es')).toBe(
      'Resumen\n\n## Otros comentarios\n\n- `src/a.ts:3` — Nit: src/a.ts:3\n- `src/a.ts:12-14` — Nit: src/a.ts:14\n',
    )
    expect(composeBody('Summary', moved, 'en')).toContain('## Other comments')
    expect(composeBody('Resumen', [], 'es')).toBe('Resumen')
  })
})

describe('buildPreview', () => {
  const files = { human: 'Hola', final: 'TEAM', comments: [c('src/a.ts', 11), c('src/a.ts', 99)], patch: PATCH }

  it('splits and puts the moved ones in the body', () => {
    const p = buildPreview(files, 'es')
    expect(p.hasHuman).toBe(true)
    expect(p.inline.map((x) => x.line)).toEqual([11])
    expect(p.moved.map((x) => x.line)).toEqual([99])
    expect(p.body).toContain('Hola')
    expect(p.body).toContain('`src/a.ts:99`')
  })

  it('falls back to final.md with no comments when final-human.md is absent', () => {
    expect(buildPreview({ ...files, human: null }, 'es')).toEqual({ body: 'TEAM', summary: 'TEAM', inline: [], moved: [], hasHuman: false })
  })

  it('has no inline comments when final-human-comments.json is absent', () => {
    const p = buildPreview({ ...files, comments: [] }, 'es')
    expect(p).toEqual({ body: 'Hola', summary: 'Hola', inline: [], moved: [], hasHuman: true })
  })
})

describe('buildReviewRequest', () => {
  it('maps state to event, adds start_side for ranges, omits an unknown commit', () => {
    expect(buildReviewRequest('request-changes', 'B', [c('a', 5), c('a', 9, { start_line: 7 })], null)).toEqual({
      event: 'REQUEST_CHANGES',
      body: 'B',
      comments: [
        { path: 'a', line: 5, side: 'RIGHT', body: 'Nit: a:5' },
        { path: 'a', line: 9, side: 'RIGHT', start_line: 7, start_side: 'RIGHT', body: 'Nit: a:9' },
      ],
    })
    expect(buildReviewRequest('approve', 'B', [], 'abc')).toMatchObject({ commit_id: 'abc', event: 'APPROVE' })
  })
})
