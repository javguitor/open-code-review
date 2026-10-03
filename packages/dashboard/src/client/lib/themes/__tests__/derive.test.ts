import { describe, it, expect } from 'vitest'
import {
  SCALE_STEPS,
  buildNeutralScale,
  contrastRatio,
  hexToOklab,
  mixOklab,
  oklabToHex,
  paletteToCssVars,
} from '../derive'
import { OMARCHY_PALETTES } from '../omarchy-palettes'

const L = (hex: string) => hexToOklab(hex)[0]

describe('OKLab helpers', () => {
  it('round-trips hex through OKLab', () => {
    for (const hex of ['#000000', '#ffffff', '#7aa2f7', '#1a1b26', '#ff0000']) {
      expect(oklabToHex(hexToOklab(hex))).toBe(hex)
    }
  })

  it('mixes at the endpoints and the midpoint', () => {
    expect(mixOklab('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixOklab('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(L(mixOklab('#000000', '#ffffff', 0.5))).toBeCloseTo(0.5, 1)
  })

  it('computes the WCAG ratio (black on white is 21)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })
})

describe('shipped palettes', () => {
  it('includes the 22 built-in and 2 user Omarchy themes, both modes', () => {
    expect(OMARCHY_PALETTES).toHaveLength(24)
    expect(new Set(OMARCHY_PALETTES.map((p) => p.mode))).toEqual(new Set(['dark', 'light']))
  })
})

describe.each(OMARCHY_PALETTES.map((p) => [p.id, p] as const))('paletteToCssVars(%s)', (_id, p) => {
  const vars = paletteToCssVars(p)
  const neutral = buildNeutralScale(p)
  const dark = p.mode === 'dark'

  it('defines every step of every overridden family as a hex colour', () => {
    for (const family of ['zinc', 'indigo', 'blue', 'violet', 'sky', 'red', 'rose', 'emerald', 'amber', 'orange']) {
      for (const step of SCALE_STEPS) expect(vars[`--color-${family}-${step}`]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('orders the neutral ramp from surface to ink (monotonic lightness)', () => {
    const ls = SCALE_STEPS.map((s) => L(neutral.zinc[s]))
    for (let i = 1; i < ls.length; i++) expect(ls[i]! - ls[i - 1]!).toBeLessThanOrEqual(0.0001)
  })

  it('overrides white only on light themes, with the page surface', () => {
    expect(vars['--color-white']).toBe(dark ? undefined : p.background)
  })

  // Text classes used by the dashboard: light `text-zinc-900`, dark `dark:text-zinc-100`
  // (primary) and `text-zinc-500` (secondary), on the page and card surfaces.
  const primary = dark ? neutral.zinc[100] : neutral.zinc[900]
  it.each([['page', neutral.page], ['card', neutral.card]])('primary text is >= 4.5:1 on the %s surface', (_n, bg) => {
    expect(contrastRatio(primary, bg)).toBeGreaterThanOrEqual(4.5)
  })
  const secondary = dark ? neutral.zinc[400] : neutral.zinc[600]
  it.each([['page', neutral.page], ['card', neutral.card]])('secondary text (dark zinc-400 / light zinc-600) is >= 4.5:1 on the %s surface', (_n, bg) => {
    expect(contrastRatio(secondary, bg)).toBeGreaterThanOrEqual(4.5)
  })
  it.each([['page', neutral.page], ['card', neutral.card]])('zinc-500 text is >= 3:1 on the %s surface', (_n, bg) => {
    expect(contrastRatio(neutral.zinc[500], bg)).toBeGreaterThanOrEqual(3)
  })

  it('keeps text-white legible on the primary button (indigo-600 >= 4.5:1)', () => {
    expect(contrastRatio(vars['--color-white'] ?? '#ffffff', vars['--color-indigo-600']!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['indigo', 'blue', 'red', 'emerald', 'amber'])('coloured text (%s, step 400 dark / 600 light) is >= 4.5:1 on the card surface', (family) => {
    const text = vars[`--color-${family}-${dark ? 400 : 600}`]!
    expect(contrastRatio(text, neutral.card)).toBeGreaterThanOrEqual(4.5)
  })
})
