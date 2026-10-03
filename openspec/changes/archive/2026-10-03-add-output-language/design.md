## Context

Three producers write what the user reads: the agent skill (markdown prompts run by
Claude Code / OpenCode), the dashboard server prompts (`human-review.ts`,
`chat-context.ts`), and the React client. Two consumers parse model output with
English regexes: `reviewer-parser.ts` (finding headings, `Severity`, `File|Location`,
`Lines`) and `final-parser.ts` (`Verdict`, `Blockers`, `Should Fix`, `Suggestions`,
and the `## Blockers` / `## Should Fix` / `## Suggestions` section headings). The
CLI validates `round-meta.json` with English enums (`APPROVE` …, `blocker` …,
`critical` …). The dashboard already resolves `ai_cli` from `.ocr/config.yaml` through
`packages/shared/config/src/dashboard-config.ts` and serves it on `GET /api/config`.

## Goals / Non-Goals

- Goals: Spanish (or any configured language) prose everywhere the user reads, with
  zero parser or schema change; one place that states the rule; UI copy switchable
  without touching stored data; keep the diff mechanical and reviewable.
- Non-Goals: translating old sessions; a full i18n framework (ICU plurals, RTL);
  locale-aware dates/numbers beyond what the browser `Intl` already gives.

## Decisions

- **Decision: `language` is a single top-level key, BCP 47, default `en`.** Read by a
  new `getOutputLanguage(ocrDir): string` in `@open-code-review/config`
  (`language-config.ts`, same shape as `dashboard-config.ts`: real YAML parse,
  invalid/missing → `en`, never throws). The skill reads the same key from YAML in
  Phase 1 (`context-discovery.md` already reads `.ocr/config.yaml`).
  - Alternative: three keys (interface / instructions / reports) as in the fork plan.
    Rejected for now: instructions are always English (prompts are English), and
    nobody has asked for UI ≠ reports; one key, split later if needed.
- **Decision: one policy text, referenced everywhere.** `references/language-policy.md`
  states: write prose in `{language}`; keep in English the exact list of structural
  tokens (headings `## Summary`, `## What I Explored`, `## Findings`, `### Finding N:`,
  `## What's Working Well`, `## Clarifying Questions`, `## Questions for Other
  Reviewers`, field labels `Severity`, `Location`/`File`, `Lines`, `Issue`, `Why It
  Matters`, `Suggestion`, final headings `## Verdict`, `## Blockers`, `## Should Fix`,
  `## Suggestions`, `## Consensus & Dissent`, `## What's Working Well`, `## Requirements
  Assessment`, `## Clarifying Questions`, `## Individual Reviews`, verdict values,
  category/severity vocabularies, discourse verbs `AGREE/CHALLENGE/CONNECT/SURFACE`,
  map headings/table columns), plus code, paths, identifiers, commands and quoted error
  messages. Each task template adds one line: "Follow `references/language-policy.md`
  with language = `{language}`". The Tech Lead passes the resolved language into every
  sub-agent prompt. The dashboard server builds the same text from a shared TS helper
  `languagePolicy(language)` in `@open-code-review/config` so the two copies cannot
  drift in substance (the markdown version is for agents; the TS version for prompts
  the dashboard composes itself).
  - Alternative: translate labels and widen the parsers. Rejected: doubles the regex
    surface for every language and still breaks on the CLI's enum validation.
- **Decision: `en` means "no policy line".** When the language is `en`, templates and
  server prompts omit the policy so current behaviour is byte-identical for English
  users (no prompt drift for upstream parity).
- **Decision: UI i18n is a 60-line module, not a dependency.**
  `client/lib/i18n/index.ts` exports `t(key, vars?)`, `useT()`, dictionaries
  `en.ts` and `es.ts` typed as `Record<MessageKey, string>` so a missing `es` key is
  a type error, not a runtime fallback; `vars` are `{name}` placeholders. Language
  comes from `GET /api/config` (`language` field added next to `aiCli`), cached in the
  existing config query; before it resolves, `en` renders. Enum-valued UI labels
  (`needs_review`, `dismissed`, verdicts, severities, phases) get keys like
  `status.needs_review`; the enum values themselves never change.
  - Alternative: react-intl / lingui. Rejected: ~160 strings, two languages, no
    plural/ICU needs; a dependency adds build config for nothing.
- **Decision: delivery in two PRs on one change.** 2a — config key, loader, agent
  policy, dashboard prompts (makes results Spanish). 2b — UI extraction. 2a is small
  and verifiable with one review run; 2b is mechanical and large.

## Risks / Trade-offs

- Models may translate a structural label anyway → the dashboard shows fewer
  findings. Mitigation: the policy lists the tokens verbatim; the Phase 7 CLI gate
  still rejects off-vocabulary verdicts/categories; 2a's acceptance test runs a full
  Spanish review and checks the dashboard counts equal `round-meta.json`.
- `--human-translated-review` / "Generate Human Review" tone rules are English-centric
  ("tbh", "fwiw"). Mitigation: the policy tells the model to use the equivalent
  register in the target language, not to transliterate those tokens.
- Upstream sync: 2a touches shared prompt templates with one referenced line each;
  2b touches many client files. Conflicts with upstream UI changes are expected and
  accepted (fork decision).

## Migration Plan

Additive. Missing `language` → `en` → no behavioural change. `nx run cli:update`
regenerates `.ocr/` copies. Rollback: revert; no persisted state depends on it.

## Open Questions

- Should the posted PR review body follow `language` even when the PR's base repo is
  an English-speaking team? (Default: yes — the setting is per project, so set it
  per repo.)
