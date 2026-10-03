## 1. Palettes

- [x] 1.1 Add `smol-toml` to the dashboard package.
- [x] 1.2 `src/shared/omarchy-theme.ts`: `OmarchyPalette` type, `parseOmarchyColors` (null on invalid), `themeDisplayName`, `normalizeHex`.
- [x] 1.3 `src/server/services/omarchy-themes.ts`: list/read/current with user-dir-wins; never throws.
- [x] 1.4 `scripts/sync-omarchy-themes.ts` + `sync:themes` script + `sync-themes` Nx target; generate and commit `omarchy-palettes.ts` (24 themes).

## 2. Derivation

- [x] 2.1 `lib/themes/derive.ts`: OKLab helpers, `contrastRatio`, `buildNeutralScale`, `paletteToCssVars`.
- [x] 2.2 Tests: conversions, monotonic ramp, contrast floors across all 24 palettes.

## 3. Server

- [x] 3.1 `routes/omarchy.ts` (`GET /api/omarchy/theme`) mounted at `/api/omarchy`.
- [x] 3.2 Tests with a temp HOME: user wins, invalid skipped, hostile id, route responses.

## 4. Client

- [x] 4.1 `theme-provider.tsx`: `colorTheme` (own `localStorage` key), variable overrides, palette-forced mode, Omarchy fetch on mount/focus with cache.
- [x] 4.2 Header toggle disabled while a palette is active.
- [x] 4.3 Settings "Theme" section with swatches, `en` + `es`.

## 5. Gate

- [x] 5.1 `nx run-many -t lint test typecheck --skip-nx-cache` green.
- [x] 5.2 `openspec validate add-omarchy-themes --strict`.
