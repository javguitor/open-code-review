# Change: Add Codex as an AI provider

## Why

The dashboard and the CLI only knew two AI CLIs (Claude Code, OpenCode). Users who work with OpenAI Codex could install the OCR skill in `.codex/skills/` but could not run reviews, chat or posting from the dashboard with it, and OCR described Codex as having no sub-agent primitive, which is outdated.

Verified on codex-cli 0.159.3:

- `codex exec --json` streams JSONL events (`thread.started`, `item.*`, `turn.completed`/`turn.failed`) and takes the prompt on stdin.
- The `multi_agent` feature is stable and enabled: the model spawns sub-agents with `spawn_agent` (`collab_tool_call` items) and may set `model` per sub-agent, so Codex self-spawns like Claude Code.
- Project skills are discovered in `.codex/skills/<name>/SKILL.md` (and `.agents/skills/`); `AGENTS.md` is read natively.
- `codex debug models` renders the model catalog as JSON, so model listing can be native.

## What Changes

- Dashboard: a `codex` AI CLI adapter (spawn, JSONL parsing, resume) registered next to Claude Code and OpenCode.
- Config: `dashboard.ai_cli` accepts `codex`; Settings gets an "AI provider" selector (Auto / Claude Code / Codex / OpenCode / Off) written through the comment-preserving writer. The change applies without restarting the dashboard.
- Host capabilities: Codex declares `subagentSpawn: true`, `perTaskModel: true`. The skill text no longer lists Codex among sequential hosts.
- Model listing: `codex` joins the vendor strategy table with a native probe (`codex debug models`).
- CLI: `ocr doctor` / dependency checks treat Codex as an AI CLI alongside Claude Code and OpenCode.
- `evolve-phase4-host-aware-spawning` drops the Codex adapter from its scope (Codex self-spawns, so it needs no OCR-orchestrated fan-out).

## Impact

- Affected specs: `dashboard`, `cli`, `review-orchestration`
- Affected code: `packages/shared/config` (`dashboard-config`, `config-writer`, `models`), `packages/shared/platform` (capability table), `packages/cli` (`deps`, `doctor`, `models`, `init` messages), `packages/dashboard` (`server/routes/config.ts`, `server/services/ai-cli/*`, Settings page, i18n), `packages/agents` (skill text)
- No data migration; existing `ai_cli` values keep working.
