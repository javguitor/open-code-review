# Change: Don't re-report what a PR already has feedback on

## Why

A re-review of a PR re-reports what earlier reviews already said. Nothing in the review reads prior feedback: reviewers and the Tech Lead never see earlier OCR rounds or the comments already on the GitHub PR, and the only cross-round link is a read-only dashboard hint against round N-1 of the same session. A re-review on another day starts a new session (sessions are keyed by date + branch), so even that hint is lost. On smith, PRs also carry feedback from humans and from an automated reviewer (`claude[bot]`) — inline threads, review bodies and conversation comments — that the author already has. Re-posting it is noise and costs the review its credibility.

## What Changes

- **Gather prior feedback (new CLI verb)**: `ocr pr prior-feedback <pr> --session-id <id> [--json]` collects, for a PR target, the feedback that already exists and writes `rounds/round-N/prior-feedback.json`:
  - GitHub (via `gh`): inline review threads (path, line, author, author kind human/bot, body, `isResolved`, `isOutdated`, URL), review bodies (author, state, body, URL) and PR conversation comments (author, body, URL);
  - OCR history (local DB): synthesized findings of earlier rounds and earlier sessions with the same `pr_number`, with their decision (accepted/dismissed/…) and whether the round was posted.
  - `gh` unavailable or failing → the file records `github: { available: false, error }` and the review continues (never blocks a review).
- **Reviewers stay blind** (Phase 4 unchanged): prior feedback is not shown to reviewers, so their analysis stays independent.
- **Synthesis classifies against prior feedback** (Phase 7): for each synthesized finding the Tech Lead records `prior`:
  - `new` (default, may be omitted);
  - `open` — already reported and still present, the earlier comment not resolved;
  - `resolved_still_present` — the earlier comment was resolved/marked fixed but the problem is still in the code;
  - `changed` — already reported but the code there changed; re-evaluated and kept because it is still a problem.
  Each non-`new` status carries `refs` (GitHub URL and author, or OCR session/round/key). Matching is semantic (same problem), helped by file and line.
- **Persistence**: `synthesis_findings.prior_json` (migration 23); `complete-round` validates the `prior` shape.
- **Posting (human-voice review)**: findings with `prior.status: "open"` are not posted as inline comments; an `open` **blocker** gets one summary line with the link to the original ("Still blocking: … (link)"); non-blocking `open` items are not posted at all. `resolved_still_present` is posted and cites the original. `new` and `changed` are posted as usual.
- **Dashboard**: synthesized findings show an "Already reported" badge with the status and links to the original feedback.

## Impact

- Affected specs: `cli` (new OCR PR Prior-Feedback Command), `review-orchestration` (gather step for PR targets; synthesis classification), `sqlite-state` (synthesis finding prior column), `slash-commands` (posting policy for prior-reported findings), `dashboard` (Already-reported badge)
- Affected code: `packages/cli` (new `pr prior-feedback` verb; `gh` GraphQL via platform helpers), `packages/shared/persistence` (migration 23, `round-meta.ts` validation, synthesis queries, OCR-history query by `pr_number`), `packages/dashboard` (synthesis finding API field + badge, i18n), `packages/agents` (workflow Phase 1 gather + Phase 7 classification, `final-template.md`, `translate-review-to-single-human.md`)
- Additive and optional: reviews of non-PR targets and payloads without `prior` behave as today.
