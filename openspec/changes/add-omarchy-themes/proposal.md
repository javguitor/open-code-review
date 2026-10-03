# Change: Omarchy color themes in the dashboard

## Why

The dashboard has one look (Tailwind's zinc/indigo palette) plus a system/light/dark
toggle. Javier runs Omarchy, whose themes (Tokyo Night, Catppuccin, Gruvbox, ...) are
what the rest of his desktop looks like, and asked for those themes to be selectable in
Settings.

## What Changes

- **Theme picker in Settings**: "Default", "Omarchy (current: <name>)" when this machine
  has Omarchy, and every shipped Omarchy palette grouped dark/light, each with a swatch.
  It is a per-browser preference (`localStorage`), applied on click with no Save step.
- **Palettes shipped with the dashboard**: `scripts/sync-omarchy-themes.ts` reads the
  Omarchy `colors.toml` files (built-ins in `/usr/share/omarchy/themes`, user themes in
  `~/.config/omarchy/themes`, user wins) with `smol-toml` and writes
  `src/client/lib/themes/omarchy-palettes.ts`, which is committed (24 themes) so the
  dashboard works on machines without Omarchy.
- **Palette -> Tailwind scales** (`lib/themes/derive.ts`, pure, OKLab): overrides
  `--color-zinc-50..950` (neutral ramp anchored on the theme's surfaces and foreground),
  `--color-white` on light themes, and the accent/semantic families
  (`indigo`, `blue`, `violet`, `sky`, `red`, `rose`, `emerald`, `amber`, `orange`) from
  single palette colours. No component class changes.
- **Light/dark follows the theme**: an active palette forces the resolved mode from its
  `mode`; the header toggle is disabled with an explanatory title. `Default` keeps
  today's behaviour unchanged.
- **Follow Omarchy**: `GET /api/omarchy/theme` returns the machine's current theme
  (`~/.local/state/omarchy/current/theme.name`) or `{ available: false }`; the client
  re-asks on window focus.

Not in scope: editing themes, themes for mermaid/hljs beyond the light/dark switch they
already follow, Windows/macOS theme sources.

## Impact

- Affected specs: `dashboard` (ADDED "Color Themes", "Omarchy Theme Endpoint", "Omarchy
  Palette Sync").
- Affected code: `packages/dashboard`: `src/shared/omarchy-theme.ts` (types + TOML
  parser), `src/server/services/omarchy-themes.ts`, `src/server/routes/omarchy.ts`,
  `src/server/index.ts`, `scripts/sync-omarchy-themes.ts` (+ `sync:themes` /
  `sync-themes` target), `src/client/lib/themes/*`, `providers/theme-provider.tsx`,
  `components/layout/header.tsx`, `features/settings/*`, i18n `settings.*`/`layout.*`.
- New dependency: `smol-toml` (dashboard package; bundled into `dist/server.js`).
