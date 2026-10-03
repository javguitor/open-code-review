# Change: Improve review understanding (plain-language overview, posted state)

## Why

Two gaps make a finished review hard to act on:

1. `final.md` opens straight at the verdict. A human who has not read the diff has to reconstruct what the task wanted and what the PR actually does from the findings. A short plain-language overview with a diagram removes that step.
2. Nothing records that a round was posted to GitHub. A closed-and-posted session and a closed-not-posted one look identical, and the open sessions list can keep showing a finished session as active because the dashboard ignores window focus (`refetchOnWindowFocus: false`) and a missed socket event is never repaired.

## What Changes

- **Overview section (internal review only)**: `final.md` gains `## What This Change Does` before `## Verdict`: two short prose parts (what the task asks, what the PR implements) and one Mermaid diagram. The single-human translation drops it; it never reaches GitHub.
- **Language policy**: `## What This Change Does` joins the English-kept headings (both copies stay in sync).
- **Dashboard markdown**: ```mermaid blocks render as diagrams, lazy-loaded, with Mermaid `securityLevel: 'strict'`. The shared renderer moves to `components/markdown/`; the review map keeps `'loose'`.
- **Posted state**: migration 20 adds `review_rounds.posted_at`, `posted_url`, `posted_state`; a successful `post:submit` records them and emits `session:updated`. Session and review APIs expose `latest_posted_*` / `posted_*`.
- **List freshness**: session list and detail queries refetch on window focus; a successful post invalidates the sessions and reviews queries.
- **UI**: a "Posted" badge (linking to the review when the URL is known) on the session card, session detail and reviews list; a "Not posted" filter on the sessions page.

## Impact

- Affected specs: `review-orchestration`, `slash-commands`, `dashboard`, `sqlite-state`
- Affected code: `packages/agents` (final template, language policy, workflow, translate command), `packages/shared/config` (language policy template), `packages/shared/persistence` (migration 20, mark-posted), dashboard server (`post-handler`, sessions/reviews routes) and client (markdown renderer, mermaid renderer, session/review components, hooks, i18n)
