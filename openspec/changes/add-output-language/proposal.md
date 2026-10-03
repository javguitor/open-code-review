# Change: Review output and dashboard in the user's language

## Why

OCR produces every reviewer file, discourse, synthesis, human-voice rewrite and chat
answer in English, and the dashboard copy is hard-coded English in 21 client files.
The language a user reads is decided by accident: by the prompt templates and by the
language of the diff or PR description. A Spanish-speaking user has to read and
decide on English findings and then rewrite the PR message by hand. The structural
labels the parsers depend on (`Severity:`, `File:`, `## Verdict`, `## Blockers`,
`## Should Fix`, `## Suggestions` — `reviewer-parser.ts:23-27`,
`final-parser.ts:24-27,92-98`) must stay English, which is exactly why a naive
"translate the output" breaks the dashboard.

## What Changes

- A new top-level `language` key in `.ocr/config.yaml` (BCP 47 tag, default `en`),
  read by the skill in Phase 1 and by the CLI/dashboard through a new
  `@open-code-review/config` loader. The `ocr init` template documents it.
- An explicit **output language policy** injected into every model task (reviewer,
  discourse, synthesis, map, human-voice rewrite, Ask-the-Team chat): prose in the
  configured language; **structural labels, headings used by the parsers, verdict
  vocabulary, finding categories/severities, code, paths, identifiers and quoted
  error messages stay in English**. The policy lives in one reference file and is
  referenced, not copied, by each task template.
- Dashboard server prompts (`human-review.ts`, `chat-context.ts`) append the same
  policy from the loader.
- Dashboard **interface localization**: a minimal in-repo `t()` with `en` and `es`
  dictionaries (no new dependency), language served by `GET /api/config`, English
  fallback for any missing key. Internal identifiers, enum values, file paths and
  session IDs are never translated; enum values get display labels through the
  dictionary.
- Changing `language` never re-runs a review or rewrites stored artifacts: existing
  sessions keep the language they were written in; the UI chrome switches.

Not in scope: translating previously generated reviews; per-reviewer languages;
locales beyond `en`/`es` dictionaries (the policy itself accepts any tag; the UI
falls back to English for others).

## Impact

- Affected specs: `config` (ADDED "Output Language Setting"), `review-orchestration`
  (ADDED "Output Language Policy"), `dashboard` (ADDED "Prompt Language Policy",
  ADDED "Interface Localization").
- Affected code:
  - `packages/shared/config/src/language-config.ts` (new) + index export; tests.
  - `packages/agents/skills/ocr/assets/config.yaml` (template), `SKILL.md`,
    `references/workflow.md` (Phase 1), new `references/language-policy.md`,
    `reviewer-task.md`, `discourse.md`, `final-template.md`, `map-workflow.md`,
    `commands/*.md` where output is described; synced to `.ocr/` with `nx run cli:update`.
  - `packages/dashboard/src/server/prompts/human-review.ts`,
    `services/chat-context.ts`, `routes/config.ts`.
  - `packages/dashboard/src/client/lib/i18n/*` (new), ~21 client files (string
    extraction), `features/*`.
- Cross-package: `config` (shared) → `cli`, `dashboard`; `agents`. No persistence
  schema change. No new dependency.
