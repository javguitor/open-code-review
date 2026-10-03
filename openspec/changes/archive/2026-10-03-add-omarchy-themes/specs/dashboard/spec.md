## ADDED Requirements

### Requirement: Color Themes

The dashboard SHALL let the user pick a colour theme in Settings: the default look, the machine's current Omarchy theme (when detected), or any shipped Omarchy palette. The choice SHALL be a per-browser preference applied immediately, and an active palette SHALL determine light/dark mode.

#### Scenario: Pick a palette

- **GIVEN** the Settings page
- **WHEN** the user selects a palette such as Tokyo Night
- **THEN** the dashboard re-colours immediately without a Save step
- **AND** the choice is stored in `localStorage` under its own key and restored on reload

#### Scenario: Palette sets light/dark

- **GIVEN** a dark palette is active while the stored mode is `light`
- **WHEN** the dashboard renders
- **THEN** the `dark` class is applied (mermaid and the dependency graph resolve dark)
- **AND** the header theme toggle is disabled with a title naming the theme

#### Scenario: Default is unchanged

- **GIVEN** the colour theme is `Default`
- **WHEN** the dashboard renders
- **THEN** no colour variable is overridden and the system/light/dark toggle behaves as before

#### Scenario: Legible text on every palette

- **WHEN** any shipped palette is derived
- **THEN** primary text is at least 4.5:1 and `zinc-500` text at least 3:1 against the page and card surfaces
- **AND** `text-white` on the primary button colour is at least 4.5:1

#### Scenario: Follow Omarchy

- **GIVEN** Omarchy is installed and the user selects "Omarchy (current: <name>)"
- **WHEN** the Omarchy theme changes and the browser tab regains focus
- **THEN** the dashboard re-colours with the new current theme

#### Scenario: Omarchy not installed

- **GIVEN** `/api/omarchy/theme` answers `{ available: false }`
- **WHEN** the Settings page renders
- **THEN** the "Omarchy (current)" option is not offered and the shipped palettes remain selectable

### Requirement: Omarchy Theme Endpoint

The dashboard server SHALL expose `GET /api/omarchy/theme`, returning the Omarchy theme currently applied on the host, and SHALL never fail when Omarchy is absent.

#### Scenario: Current theme

- **GIVEN** `~/.local/state/omarchy/current/theme.name` names an installed theme
- **WHEN** the endpoint is called
- **THEN** it returns `{ available: true, id, name, palette }`, taking the theme from `~/.config/omarchy/themes/<id>` when present and from `/usr/share/omarchy/themes/<id>` otherwise

#### Scenario: No Omarchy or unreadable theme

- **GIVEN** the state file, the theme directory or its `colors.toml` is missing or invalid
- **WHEN** the endpoint is called
- **THEN** it returns `200 { available: false }`

### Requirement: Omarchy Palette Sync

The dashboard SHALL ship the Omarchy palettes as a committed, generated module produced by `sync-omarchy-themes.ts`, which parses each theme's `colors.toml` with a TOML parser and refuses to overwrite the module when no theme is found.

#### Scenario: Regenerate

- **GIVEN** a machine with Omarchy themes installed
- **WHEN** `pnpm sync:themes` runs in the dashboard package
- **THEN** `omarchy-palettes.ts` is rewritten with every valid theme sorted by id, user themes overriding built-ins

#### Scenario: Invalid theme file

- **GIVEN** a `colors.toml` with invalid TOML, a missing colour or a non-hex value
- **WHEN** it is parsed
- **THEN** that theme is skipped and the others are unaffected
