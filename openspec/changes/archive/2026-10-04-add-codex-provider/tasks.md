## 1. Config and capabilities
- [x] 1.1 `AiCliPreference` accepts `codex`; `dashboard.ai_cli` joins the config-writer allow-list (values `auto|claude|codex|opencode|off`) with tests
- [x] 1.2 Codex host capabilities `{ subagentSpawn: true, perTaskModel: true }`; update tests and skill text that said Codex runs Phase 4 sequentially
- [x] 1.3 Codex entry in `VENDOR_MODEL_STRATEGIES` (native probe `codex debug models`, parser, tests)

## 2. CLI
- [x] 2.1 Codex in dependency checks / `ocr doctor` and the "install an AI CLI" messages

## 3. Dashboard
- [x] 3.1 `GET /api/config` exposes `ai_cli`; `PATCH /api/config` accepts `dashboard.ai_cli` and calls `AiCliService.setPreference`
- [x] 3.2 Settings "AI provider" selector (en + es) showing installed and active CLIs
- [x] 3.3 Codex adapter (`spawn`, JSONL parser, resume) and tool rendering — tracked in the adapter work of this change

## 4. Spec
- [x] 4.1 Spec deltas and `openspec validate add-codex-provider --strict`
- [x] 4.2 Trim the Codex adapter from `evolve-phase4-host-aware-spawning`
