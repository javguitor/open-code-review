## 1. Config key and loader (shared)

- [x] 1.1 `packages/shared/config/src/language-config.ts`: `getOutputLanguage(ocrDir): string` (YAML parse, `language` top-level, trimmed, lowercased tag; missing/invalid → `en`, never throws) and `languagePolicy(language): string | null` (`null` for `en`; otherwise the policy text listing the English-only tokens). Export from the package index. Tests: missing file, missing key, `es`, `es-ES`, non-string, malformed YAML.
- [x] 1.2 `packages/agents/skills/ocr/assets/config.yaml`: documented `# language: en` block (what it affects, what stays English).

## 2. Agent prompts (packages/agents, then `nx run cli:update`)

- [x] 2.1 New `skills/ocr/references/language-policy.md`: the policy text (same substance as `languagePolicy()`), with the verbatim token list and the "`en` → no policy" rule.
- [x] 2.2 `references/workflow.md` Phase 1: read `language` from `.ocr/config.yaml` (default `en`), record it in `discovered-standards.md` under `## Output Language`, and pass it to every sub-agent task; Phase 7 note that `final.md` prose follows it while headings/vocabularies stay English.
- [x] 2.3 `references/reviewer-task.md`, `discourse.md`, `final-template.md`, `map-workflow.md`: one "Language" line each referencing the policy with `{language}`; the ephemeral-reviewer variant too.
- [x] 2.4 `SKILL.md` Configuration section lists `language`; `commands/review.md`, `map.md`, `post.md`, `translate-review-to-single-human.md`, `address.md` mention that prose follows `language`.
- [x] 2.5 `nx run cli:update`; commit source + `.ocr/`.

## 3. Dashboard server prompts

- [x] 3.1 ~~`prompts/human-review.ts`~~ — superseded: `buildHumanReviewPrompt` has no production caller (the rewrite runs `commands/translate-review-to-single-human.md`); the file and its test are deleted in block 6 and the command carries the rule (2.4).
- [x] 3.2 `services/chat-context.ts`: append the same policy to the first-message context. `post-handler.ts` / `chat-handler.ts` resolve the language with `getOutputLanguage(ocrDir)`.
- [x] 3.3 `routes/config.ts`: add `language` to the `GET /api/config` payload.
- [x] 3.4 Tests: human-review prompt with `es` contains the policy and with `en` is unchanged; config route returns `language`.

## 4. Acceptance for 2a

- [x] 4.1 `language: es` in this repo's `.ocr/config.yaml`; run `/ocr:review` on a small branch; check: reviewer files parsed (dashboard finding counts == `round-meta.json`), `final.md` prose in Spanish with English headings, `complete-round` accepted the verdict, human-voice rewrite in Spanish.
- [x] 4.2 `nx run-many -t lint test typecheck` green; `openspec validate add-output-language --strict` green.

## 5. Interface localization (2b)

- [ ] 5.1 `client/lib/i18n/{index.ts,en.ts,es.ts}`: `MessageKey` union derived from `en`, `t()`, `useT()` reading `language` from the config query, `{var}` interpolation, English fallback while loading.
- [ ] 5.2 Extract strings by feature directory (one agent per group): `sessions`, `reviews` (incl. post dialog), `commands` + `map`, `chat` + `reviewers` + `team` + shell/nav (`components/ui`, `status-badge`, layout).
- [ ] 5.3 Enum display labels (`status.*`, `verdict.*`, `severity.*`, `phase.*`) through keys; values untouched.
- [ ] 5.4 Unit tests: `t()` interpolation, fallback, every `en` key present in `es` (type-level + runtime assertion).
- [ ] 5.5 Browser check in `es` and `en` on the round page and post dialog.

## 6. Fixes from the Spanish acceptance review (should-fix 1–3, suggestions 1–2)

- [ ] 6.1 Drift test: `language-config.test.ts` reads `packages/agents/skills/ocr/references/language-policy.md` via `readFileSync` and asserts its `## Output Language` block equals `languagePolicy('{language}')`.
- [ ] 6.2 Extend the token list in BOTH copies: `**Blockers**: N` / `**Should Fix**: N` / `**Suggestions**: N` bold counts; map `## Section N:`, table columns `Done` / `File` / `Role` / `Type` / `Description`, `**Files**`, `**The Story**:`.
- [ ] 6.3 Delete `prompts/human-review.ts` and its test (dead code; spec scenario now points at the command).
- [ ] 6.4 `languagePolicy` returns `null` for tags that fail `LANGUAGE_TAG`.
- [ ] 6.5 Placeholder consistency in agent docs: `OUTPUT_LANGUAGE` only where defined (`workflow.md` Phase 1); `{language}` elsewhere; rename "1a-bis" to a plain sub-step. `nx run cli:update`.

## Findings

Acceptance 4.1 (2026-10-03): session `2026-10-03-feat-output-language`, `language: es`, team `principal:1,quality:1`.
- Reviewer files in Spanish with English structure: `parseReviewerOutput` extracted 6/6 and 7/7 findings (+1 spurious `title='s'` from `## Findings` — pre-existing `FINDING_HEADING_RE` bug, identical on the English baseline session).
- `final.md` in Spanish: `parseFinalMd` → `APPROVE / 0 / 4 / 5` == `round-meta.synthesis_counts`; `complete-round` accepted.
- Verdict APPROVE; 4 should-fix → block 6.

