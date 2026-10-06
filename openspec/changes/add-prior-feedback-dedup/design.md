## Context

Prior feedback on a PR lives in two places: OCR's own history (synthesized findings per round, decisions, posted state; sessions linked only by `sessions.pr_number`) and GitHub (inline review threads with resolved/outdated state, review bodies, conversation comments; from humans, from our own posted reviews and from bots). Today none of it reaches the review; the dashboard only shows a post-hoc hint against round N-1 of the same session (`routes/reviews.ts`, "Informational only").

## Goals / Non-Goals

- Goals: a re-review does not re-post what the PR already has; it still says when something "fixed" is not fixed; the dashboard shows what was already reported and where.
- Non-Goals: replying in or resolving existing GitHub threads; deduplicating within a round (synthesis already merges); non-PR targets; changing how reviewers analyze.

## Decisions

- **Deduplicate in synthesis, not in reviewers.** Reviewers stay blind to prior feedback so their analysis is independent (showing it anchors them and hides "marked fixed but still broken"). The Tech Lead, who already merges reviewer findings semantically, also matches them against prior feedback. Rejected: filtering at posting time only (the dashboard would still list duplicates, and matching there is mostly textual); reviewer-side suppression (bias).
- **A CLI verb gathers, the agent judges.** `ocr pr prior-feedback` is deterministic I/O (GitHub GraphQL with pagination + DB query) with a stable JSON shape, like `ocr requirements fetch`. Semantic matching stays with the Tech Lead. The file is written into the round directory so the synthesis and the human-voice step read the same snapshot.
- **GitHub via `gh api graphql`**: `reviewThreads` (isResolved, isOutdated, path, line, first comment author/body/url, author `__typename` Bot vs User), `reviews` (author, state, body, url; empty bodies skipped), `comments` (conversation). Through the platform exec helper (no raw `child_process`). Bodies are capped per item and the file records counts, so a very chatty PR cannot blow up the context.
- **OCR history by `pr_number`**: synthesized findings of every earlier round of every session with that `pr_number` (excluding the current round), with title, summary, locations, decision status and the round's posted state. Legacy rounds without synthesis contribute reviewer findings with the same fields when available.
- **Status vocabulary** (`prior.status`): `new` | `open` | `resolved_still_present` | `changed` | `dismissed`. `refs[]`: `{ source: "github", url, author, author_kind: "human"|"bot", kind: "thread"|"review"|"comment" }` or `{ source: "ocr", session_id, round, key }`. Non-`new` requires ≥1 ref. Stored as JSON (`synthesis_findings.prior_json`), validated by `complete-round` (exit 7 on bad shape, same self-correct loop).
- **Posting policy** (decided with the user): `open` → no inline comment; `open` + blocker → one summary line with the link; `open` non-blocking → silent; `resolved_still_present` → posted, citing the original; `dismissed` → never posted (not even as a summary line, even a blocker); `new`/`changed` → as usual. The JSON `final-human-comments.json` simply omits suppressed findings.
- **Failure is non-blocking**: no `gh`, no auth, API error or non-PR target → `prior-feedback.json` with `github.available: false` (or not written for non-PR targets); synthesis treats everything as `new` except OCR-history matches.

## Risks / Trade-offs

- False "already reported" → a real finding is silenced. Mitigation: only `open` and `dismissed` are suppressed; both need a concrete ref (`dismissed` an explicit rejection: a `dismissed`/`wont_fix` decision or a rejection reply), and the dashboard still shows them with the link.
- Cost/latency of an extra GitHub fetch → one paginated GraphQL call set per review; capped bodies.
- Bot noise as a source → bot comments count (the author has them), per the user's decision.

## Migration Plan

Migration 23 adds nullable `synthesis_findings.prior_json`. Older rounds read as `new`. No backfill.
