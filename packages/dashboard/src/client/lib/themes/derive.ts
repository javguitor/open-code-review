/**
 * Turns an Omarchy palette (a few dozen terminal colours) into the Tailwind
 * colour scales the dashboard's utility classes resolve to.
 *
 * The dashboard is written against Tailwind's `zinc-50..950` and a handful of
 * accent families (`indigo`, `red`, `emerald`, ...), so a theme works by
 * overriding the `--color-<family>-<step>` CSS variables on `:root`; no class
 * in any component changes.
 *
 * Everything here is pure and interpolates in OKLab (perceptually even steps),
 * so it is unit-tested without a DOM.
 */

import type { OmarchyPalette } from '../../../shared/omarchy-theme'

// ── sRGB <-> OKLab ──────────────────────────────────────────────────────────

type Rgb = readonly [number, number, number] // 0..1, gamma-encoded
type Lab = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/** Björn Ottosson's OKLab. */
export function hexToOklab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return rgbToHex([
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ])
}

/** `t` = 0 gives `a`, 1 gives `b`. */
export function mixOklab(a: string, b: string, t: number): string {
  const x = hexToOklab(a)
  const y = hexToOklab(b)
  return oklabToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

const lightness = (hex: string) => hexToOklab(hex)[0]

/** Moves OKLab lightness by `delta`, keeping hue and chroma. */
function shiftLightness(hex: string, delta: number): string {
  const [L, a, b] = hexToOklab(hex)
  return oklabToHex([Math.min(1, Math.max(0, L + delta)), a, b])
}

// ── WCAG contrast ───────────────────────────────────────────────────────────

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// ── Scales ──────────────────────────────────────────────────────────────────

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
type Step = (typeof SCALE_STEPS)[number]

/** OKLCH lightness of Tailwind v4's zinc scale: the curve the neutral ramp follows. */
const ZINC_L: Record<Step, number> = {
  50: 0.985, 100: 0.967, 200: 0.92, 300: 0.871, 400: 0.705, 500: 0.552,
  600: 0.442, 700: 0.37, 800: 0.274, 900: 0.21, 950: 0.141,
}

/** Smallest OKLab lightness gap for two surface colours to count as different layers. */
const MIN_SURFACE_GAP = 0.03
/** Gap synthesised when a palette has too few distinct surfaces (e.g. a pure-black theme). */
const SYNTH_SURFACE_GAP = 0.045
const MIN_TEXT_CONTRAST = 4.5
/** `text-zinc-500` is the dashboard's placeholder/tertiary text; keep it at the WCAG large-text floor. */
const MIN_MUTED_CONTRAST = 3

/**
 * Orders candidate surface colours away from the foreground (darkest first for
 * a dark theme) and keeps only those visibly different from the previous one,
 * padding with synthetic steps up to `count`. Palettes are not reliably
 * ordered (`darker_background` of `vantablack` is lighter than its
 * `background`), so the ladder is built from lightness, never from key names.
 */
function surfaceLadder(candidates: string[], dir: 1 | -1, count: number): string[] {
  const sorted = [...candidates].sort((a, b) => dir * (lightness(a) - lightness(b)))
  const ladder: string[] = []
  for (const c of sorted) {
    const last = ladder[ladder.length - 1]
    if (last === undefined || dir * (lightness(c) - lightness(last)) >= MIN_SURFACE_GAP) ladder.push(c)
  }
  while (ladder.length < count) ladder.push(shiftLightness(ladder[ladder.length - 1]!, dir * SYNTH_SURFACE_GAP))
  return ladder
}

const extreme = (colors: string[], dir: 1 | -1) =>
  [...colors].sort((a, b) => dir * (lightness(b) - lightness(a)))[0]!

/** Smallest mix weight in [from, 1] for which `colorAt(t)` reaches `min` contrast against `against`. */
function minWeightForContrast(colorAt: (t: number) => string, against: string, from: number, min: number): number {
  for (let t = from; t < 1; t += 0.02) {
    if (contrastRatio(colorAt(t), against) >= min) return t
  }
  return 1
}

/** Rescales weights in (from, 1] so they start at `newFrom`, keeping order and the 1.0 end. */
const rescale = (t: number, from: number, newFrom: number) => newFrom + ((t - from) * (1 - newFrom)) / (1 - from)

/** A text step: the curve's own weight, or the first heavier one that reaches `min` contrast on `card`. */
const textStep = (colorAt: (t: number) => string, card: string, curveT: number, min: number) =>
  colorAt(minWeightForContrast(colorAt, card, curveT, min))

export interface NeutralScale {
  /** `zinc-50..950`. */
  zinc: Record<Step, string>
  /** Replacement for `white` (light themes only: the page surface). */
  white: string | null
  /** Page surface (what text must be legible against). */
  page: string
  /** Card / sidebar surface. */
  card: string
  /** The foreground end of the ramp. */
  ink: string
}

/**
 * Neutral ramp, anchored on the theme.
 *
 * Dark theme (surfaces ascend with the step, ink at 50):
 *   950 / 900 / 800 = the three lowest *distinct* surfaces among
 *   darker_background, dark_background, background, lighter_background,
 *   selection; 700..50 interpolate (OKLab) from 800 to the lightest of
 *   foreground / light_foreground / bright_foreground, following zinc's own
 *   lightness curve.
 *
 * Light theme (mirrored: surfaces at the low steps, ink at 950):
 *   white = background; 50 / 100 / 200 = the next distinct, darker surfaces
 *   among dark_background, darker_background, selection; 300..950 interpolate
 *   from 200 to the darkest of the foreground keys.
 */
export function buildNeutralScale(p: OmarchyPalette): NeutralScale {
  const dark = p.mode === 'dark'
  const fg = [p.foreground, p.light_foreground, p.bright_foreground]

  if (dark) {
    const [s950, s900, s800] = surfaceLadder(
      [p.darker_background, p.dark_background, p.background, p.lighter_background, p.selection],
      1,
      3,
    ) as [string, string, string]
    const ink = extreme(fg, 1)
    const zinc = { 950: s950, 900: s900, 800: s800 } as Record<Step, string>
    for (const step of [700, 600, 500, 400, 300, 200, 100, 50] as const) {
      zinc[step] = mixOklab(s800, ink, (ZINC_L[step] - ZINC_L[800]) / (ZINC_L[50] - ZINC_L[800]))
    }
    // zinc's own curve sits too close to a theme's surfaces; push the text steps toward the ink until they read.
    const darkAt = (t: number) => mixOklab(s800, ink, t)
    const darkT = (step: Step) => (ZINC_L[step] - ZINC_L[800]) / (ZINC_L[50] - ZINC_L[800])
    zinc[500] = textStep(darkAt, s900, darkT(500), MIN_MUTED_CONTRAST)
    zinc[400] = textStep(darkAt, s900, darkT(400), MIN_TEXT_CONTRAST)
    return { zinc, white: null, page: s950, card: s900, ink }
  }

  const [s0, s50, s100, s200] = surfaceLadder(
    [p.background, p.dark_background, p.darker_background, p.selection],
    -1,
    4,
  ) as [string, string, string, string]
  const ink = extreme(fg, -1)
  const zinc = { 50: s50, 100: s100, 200: s200 } as Record<Step, string>
  const lightAt = (t: number) => mixOklab(s200, ink, t)
  const lightT = (step: Step) => (ZINC_L[200] - ZINC_L[step]) / (ZINC_L[200] - ZINC_L[950])
  // 600 is the secondary-text step: if it has to move toward the ink to read, the steps beyond it
  // are squeezed into the remaining range so the ramp stays monotonic.
  const t600 = minWeightForContrast(lightAt, s50, lightT(600), MIN_TEXT_CONTRAST)
  for (const step of [300, 400, 500] as const) zinc[step] = lightAt(lightT(step))
  for (const step of [600, 700, 800, 900, 950] as const) zinc[step] = lightAt(rescale(lightT(step), lightT(600), t600))
  zinc[500] = textStep(lightAt, s50, lightT(500), MIN_MUTED_CONTRAST)
  return { zinc, white: s0, page: s0, card: s50, ink }
}

/** Mix weight toward the "light" end for steps 50..400 and toward the "dark" end for 600..950. */
const TINT_T: Record<Step, number> = {
  50: 0.92, 100: 0.84, 200: 0.68, 300: 0.5, 400: 0.25, 500: 0,
  600: 0.2, 700: 0.4, 800: 0.6, 900: 0.78, 950: 0.9,
}


/**
 * One accent family around a single colour (`500` = the colour itself).
 *
 * Light steps (50..400) mix toward the theme's light end, dark steps (600..950)
 * toward its dark end. Two steps are then pushed far enough to stay legible:
 *  - `600` carries `text-white` on buttons, so it must reach 4.5:1 against
 *    `white` (the theme's surface on light themes, plain white on dark ones),
 *    and on light themes also against the card as the coloured text step;
 *  - on dark themes `400` is the coloured *text* step, so it must reach 4.5:1
 *    against the card surface.
 */
function buildFamily(base: string, p: OmarchyPalette, neutral: NeutralScale): Record<Step, string> {
  const dark = p.mode === 'dark'
  const lightEnd = dark ? neutral.ink : neutral.page
  const darkEnd = dark ? neutral.zinc[950] : neutral.ink
  const white = neutral.white ?? '#ffffff'

  const towardDark = (t: number) => mixOklab(base, darkEnd, t)
  const t600 = Math.max(
    minWeightForContrast(towardDark, white, TINT_T[600], MIN_TEXT_CONTRAST),
    // light themes: 600 is also the coloured text step, and the card (50) is darker than the page
    dark ? 0 : minWeightForContrast(towardDark, neutral.card, TINT_T[600], MIN_TEXT_CONTRAST),
  )
  const t400 = dark
    ? minWeightForContrast((t) => mixOklab(base, lightEnd, t), neutral.card, TINT_T[400], MIN_TEXT_CONTRAST)
    : TINT_T[400]

  const out = { 500: base } as Record<Step, string>
  for (const step of [600, 700, 800, 900, 950] as const) {
    out[step] = mixOklab(base, darkEnd, rescale(TINT_T[step], TINT_T[600], t600))
  }
  for (const step of [400, 300, 200, 100, 50] as const) {
    out[step] = mixOklab(base, lightEnd, step === 400 ? t400 : rescale(TINT_T[step], TINT_T[400], t400))
  }
  return out
}

/** Tailwind family -> the palette colour it follows. */
function familySources(p: OmarchyPalette): Record<string, string> {
  return {
    indigo: p.accent,
    blue: p.blue,
    violet: p.magenta,
    sky: p.cyan,
    red: p.red,
    rose: p.red,
    emerald: p.green,
    amber: p.yellow,
    orange: p.orange ?? p.bright_yellow,
  }
}

/**
 * CSS custom-property overrides (`--color-zinc-900: #...`) that re-skin the
 * dashboard with `p`. Apply on `:root`; remove them to restore the default look.
 */
export function paletteToCssVars(p: OmarchyPalette): Record<string, string> {
  const neutral = buildNeutralScale(p)
  const vars: Record<string, string> = {}
  for (const step of SCALE_STEPS) vars[`--color-zinc-${step}`] = neutral.zinc[step]
  if (neutral.white) vars['--color-white'] = neutral.white
  for (const [family, color] of Object.entries(familySources(p))) {
    const scale = buildFamily(color, p, neutral)
    for (const step of SCALE_STEPS) vars[`--color-${family}-${step}`] = scale[step]
  }
  return vars
}
