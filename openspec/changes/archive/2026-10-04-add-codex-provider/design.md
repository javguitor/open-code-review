## Context

`AiCliService` picks one adapter at startup from `dashboard.ai_cli` plus binary detection. Capabilities and model listing live in shared tables (`HOST_CAPABILITIES`, `VENDOR_MODEL_STRATEGIES`) that the CLI and the dashboard both read.

## Decisions

- **Codex capabilities are `{ subagentSpawn: true, perTaskModel: true }`.** Verified against the real CLI (`multi_agent` stable and enabled; `spawn_agent` accepts a per-sub-agent `model`). Phase 4 therefore runs as parallel sub-agents, the same strategy as Claude Code, and OCR does not fan out Codex children itself.
- **Model listing is native.** `codex debug models` prints `{ models: [{ slug, display_name, visibility, ... }] }`; only `visibility: "list"` entries are offered (`hide` ones are internal). The output is ~600 KB because it embeds prompt text, so the probe declares a larger `maxBuffer` than the 1 MiB default used for the other vendors. A short bundled list covers the failure case, with the reason reported as for every other vendor.
- **Preference changes apply live.** `AiCliService.setPreference()` re-runs adapter selection against the detection results captured at startup. Re-detection is not repeated: installing a CLI while the dashboard runs still needs a restart, as before.
- **The Settings value is the raw preference.** `GET /api/config` returns `ai_cli` (what the file says) next to `aiCli` (available / active / preferred). When the chosen vendor is not installed the service falls back to auto-detection (existing behavior), and the UI shows which one is active.
- **Alternative rejected: a separate endpoint for the provider.** The existing allow-listed `PATCH /api/config` and its comment-preserving writer already cover this; one more key is a smaller diff than a new route.

## Risks / Trade-offs

- A non-existent or unreadable `codex debug models` falls back to the bundled list (stale by construction); free-text model ids stay accepted.
- `codex exec` waits on stdin; the adapter must always write and end the prompt (see the dashboard delta).
