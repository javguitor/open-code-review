## Context

Components are written against Tailwind classes (`bg-zinc-900`, `text-indigo-600`,
`dark:...`) that Tailwind v4 resolves to `var(--color-<family>-<step>)`. Overriding
those variables on `:root` re-skins everything without touching a component.

## Decisions

- **Decision: override Tailwind's colour variables, not the components.** ~3,000 class
  usages across the app; the variables are the single choke point.
  - Alternative: semantic tokens (`bg-surface`). Rejected: a repo-wide rewrite for a
    cosmetic feature.
- **Decision: real TOML parser (`smol-toml`).** The files have comments and could grow
  tables; the same `parseOmarchyColors` (in `src/shared/`) serves the sync script and
  the server, and returns `null` instead of throwing.
- **Decision: ship the palettes as generated TypeScript.** The client must offer the
  themes on machines without Omarchy; the server endpoint only supplies the *current*
  one. Alternative: fetch the list from the server. Rejected: empty list off-Omarchy.
- **Decision: neutral ramp from lightness, not key names.** Omarchy palettes are not
  consistently ordered (`vantablack`'s `darker_background` is lighter than its
  `background`). The ladder takes the distinct surfaces sorted by OKLab lightness
  (min gap 0.03, synthesised if the theme has too few), so layers always differ.
  - Dark: `950/900/800` = three lowest distinct surfaces among darker_background,
    dark_background, background, lighter_background, selection; `700..50` interpolate
    from `800` to the lightest foreground following zinc's own lightness curve.
  - Light (mirrored): `white` = background; `50/100/200` = next distinct darker
    surfaces among dark_background, darker_background, selection; `300..950` interpolate
    from `200` to the darkest foreground.
  - Text steps are pushed toward the ink until they reach contrast floors: `zinc-500`
    >= 3:1, secondary text (dark `zinc-400` / light `zinc-600`) >= 4.5:1.
- **Decision: families from single colours.** `500` = the palette colour; lighter steps
  mix toward the theme's light end, darker steps toward its dark end. `600` is pushed
  until `text-white` is >= 4.5:1 on it (buttons), and on dark themes `400` until it is
  >= 4.5:1 on the card (coloured text). Mapping: indigo<-accent, blue<-blue,
  violet<-magenta, sky<-cyan, red/rose<-red, emerald<-green, amber<-yellow,
  orange<-orange or bright_yellow.
- **Decision: the palette forces light/dark.** A dark palette under the `light` class
  would leave every `dark:` variant inactive; the resolved mode comes from the palette.

## Risks

- Hard-coded colours (hljs, mermaid, dependency graph) follow only the light/dark
  switch, not the palette; acceptable for v1.
- `omarchy-current` is unknown until the first fetch; the last palette seen is cached in
  `localStorage` to avoid a flash.
