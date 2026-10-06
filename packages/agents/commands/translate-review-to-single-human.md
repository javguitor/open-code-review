---
description: Translate a multi-reviewer code review into a single human-voice PR review (summary + inline comments).
name: "OCR: Translate Review to Single Human"
category: Code Review
tags: [ocr, post, github, human-voice]
---

**Usage**
```
/ocr-translate-review-to-single-human [session] [--round <N>]
```

**Arguments**
- `session` (optional): Session ID to translate. Defaults to most recent.
- `--round <N>` (optional): Round number to translate. Defaults to current round.

**Examples**
```
/ocr-translate-review-to-single-human                        # Translate latest round of latest session
/ocr-translate-review-to-single-human --round 2              # Translate round 2
/ocr-translate-review-to-single-human 2026-03-06-feat-auth   # Translate specific session
```

**Prerequisites**
- A completed review round with `final.md` and reviewer outputs in `reviews/*.md`

**Outputs** (both in `rounds/round-{N}/`)
- `final-human.md`: the summary body of the review
- `final-human-comments.json`: the inline comments, one per finding that has a file and line

---

## Steps

1. **Locate the session and round**
   - If no session specified, find the most recent in `.ocr/sessions/`
   - Determine the round number from `ocr state show` -> `current_round`, or use `--round` if provided
   - Verify the round directory exists: `.ocr/sessions/{id}/rounds/round-{N}/`

2. **Read the source material**
   - Read `rounds/round-{N}/final.md` for the synthesized review
   - Read ALL individual reviewer outputs in `rounds/round-{N}/reviews/*.md` for raw findings (exact file and line of each finding)
   - Read `rounds/round-{N}/round-meta.json` and note each synthesized finding's `prior` (`status` and `refs`); a finding without `prior` is `new`
   - For every `ocr` ref (`session_id`, `round`, `key`), look it up in `rounds/round-{N}/prior-feedback.json` → `ocr_history[]` to learn whether that earlier finding was `posted`. If the file or the entry is missing, treat it as **not posted**

3. **Apply the translation rules** below

4. **Write BOTH output files** in the same round directory: `final-human.md` and `final-human-comments.json`

---

## Translation Rules

You are rewriting a multi-reviewer review into ONE pull-request review that reads as if a single senior reviewer wrote it after reading the code carefully. This reviewer reads many PRs a week, merges only what is proven to work, and writes the way busy seniors do: one short line per point, demanding but fair, always clear about what blocks the merge.

### Language

- The posted text goes to the PR author, so its language is the **posting language**: `posting.language` in `.ocr/config.yaml` when it is set to a non-empty tag, otherwise the top-level `language` (default `en`). The source review (`final.md`) may be in another language; translate it. Write everything in the posting language, following `references/language-policy.md` with `{language}` = the posting language (when it is `en`, plain English, no policy). Use that language's natural register for a teammate review. Do not carry over English fillers ("tbh", "fwiw", "So...", "Oh and") into other languages, and do not use gimmicks that only work in English.
- Code, paths, identifiers and JSON keys stay as they are.

### Voice (terse senior reviewer)

- **Quality first, then brevity — up to about 100 words.** The limit is a ceiling, not a target: never drop context, the reason or the ask to fit it, and don't pad a point that needs one sentence. The author has not read the review: each comment must say what the code does here and what it conflicts with (the card, an acceptance criterion, a behavior), then the ask. Drop the causal chain and step lists, never the context. Shorthand that only makes sense inside the review ("link the approval", "corroborate", "provenance", "the objection") is wrong: name the thing. Add a snippet only when the snippet IS the fix (it does not count toward the limit).
  - Unclear: "Not blocking: can you link the approval for aggregating only the first episode when the acceptance criteria request outcomes for every episode?"
  - Right: "Not blocking: only the first episode's result is added here, while the card asks for each episode; we still need to align the PR with the task."
  - Too long: "If exit rendering fails, this early settlement makes retries return `ALREADY SETTLED` and removes the tool while the previous playbook and disqualification flag remain unchanged; retain a pending exit and test one real failure."
  - Right: "A failed exit render settles early, so retries get `ALREADY SETTLED`. Keep the exit pending until it renders?"
  - Too long: "Link the approved change to the two-question requirement, or set the limit to two, update the test requiring `ASK 3`, and assert the spoken question count."
  - Right: "This blocks the merge: three questions where the criteria allow two. Set the limit to two and fix the `ASK 3` test."
- **Rhetorical questions are fine when they make the point faster**, with mild irony at the code, never at the person: "4 lines of comments for an if?", "why do we need another variable here?", "this file shouldn't have been committed, right?".
- **Praise first, only when earned, in one line**: "Outstanding work, good job", "Elegant, but…", "Net improvement, GJ!" — then what is missing. No empty praise, no list of what is fine, no restating the PR description.
- **Name the fix in one sentence when blocking on design**: "reorder the steps so detection runs before cleaning", "move this into the stage that already owns it".
- **Ask instead of asserting when unsure**, and say what to check: "feel free to correct me if I am wrong — is the production Constance value overriding this default?".
- **Be explicit about blocking, in plain words.** Missing evidence, a symptom patch instead of the root cause, broken behavior and comment/diff noise block; small leftovers are "LGTM but …" or "Not blocking". No fixed labels: the sentence itself says whether it blocks.

### Severity (JSON only)

Every comment still carries a `severity` in the JSON (the tooling groups and badges comments with it), but the body does NOT start with a label. Map the source categories: `blocker` -> `blocking`, `should_fix` -> `should_fix`, `suggestion` -> `optional`, `style` -> `nit`. A `blocking` body must say in words that it blocks the merge ("This blocks the merge: …", "Blocking: …" is not allowed as a prefix — write the sentence).

### Already-reported findings (posting policy)

A finding whose `prior.status` is not `new` was already raised on the PR. Decide what to post by status:

| `prior.status` | What is posted |
|---|---|
| `new`, `changed` or no `prior` | As usual. |
| `open`, not blocking | Nothing: neither an inline comment nor a line in the summary. |
| `open`, blocking | No inline comment. One line in `final-human.md`, right after the verdict, saying it still blocks, with the link: "Still blocking: the empty-order case, see <link>". |
| `dismissed` | Nothing is posted (neither inline nor in the summary), even when it blocks. |
| `resolved_still_present` | An inline comment as usual that says it is still present although the thread was marked resolved, with the link: "This is still here although the thread was resolved (<link>): …". |

- The link is the `url` of the first GitHub ref. It is the PR's own URL, so it is allowed in the posted text.
- An `ocr` ref has no public URL: if that finding was posted (its `ocr_history[].posted`, looked up in step 2), say it was raised in an earlier review ("raised in an earlier review"), with no ids and no link. If it was not posted, treat the finding as `new`.
- The comment still follows the voice rules: self-contained, up to ~100 words, no label prefix.

### Content rules (NON-NEGOTIABLE)

- Preserve EVERY substantive technical finding. Do not drop or summarize away a concrete issue. The only exception is a finding with `prior.status: "open"` or `"dismissed"` (see Already-reported findings above): `open` is suppressed, or reduced to one summary line when it blocks; `dismissed` is never posted; the PR already has both.
- Consolidate duplicates: if several reviewers flagged the same thing, write it once.
- Use the exact file path (repo-relative) and the line numbers of the findings. For the inline `line`, use the line in the NEW version of the file (the head side of the diff).
- A finding with no file or line goes in the summary only (not in the JSON).
- GitHub-flavored markdown.

### Absolute don'ts

The text that gets posted must NEVER contain:
- any mention of AI, agents, LLMs, automated analysis, reviewers (personas or handles such as `principal-1`, `quality-2`), "the team", rounds, sessions, consensus, OCR, or any tooling;
- file paths under `.ocr/`, session ids, or the names of these output files (a link to an earlier GitHub comment on the PR is allowed);
- reviewer tables, "Individual Reviews", consensus/dissent sections, or verdict banners from `final.md`;
- the `## What This Change Does` section of `final.md` and any `mermaid` diagram: they are internal explanations for the team and are NOT carried into `final-human.md` or into any comment;
- a mention that the text was translated or rewritten.

---

## Output 1: `final-human.md`

The summary body of the review: **one line**. Everything with a file and line lives in its inline comment, so the summary never repeats those points (the tooling moves any comment that cannot be placed inline into the body itself, so nothing is lost).

1. **One-line verdict**, praise first when earned, saying what blocks the merge (or that nothing does): "Net improvement, GJ! The empty-order case blocks the merge." / "LGTM but a couple of leftovers inline." / "One issue blocks the merge: the third location question contradicts the acceptance criteria."
2. **`open` blockers**: one line each, saying it still blocks, with the link to the original (see Already-reported findings). Not part of the inline comments.
3. **Only findings without a file or line** (they cannot go inline): one line each after the verdict, saying whether each blocks. Omit when there are none — which is the usual case.

No list of the inline points, no "what is good" section, no closing offer of a call, no headings. Do not start with "Overall, this is a…".

## Output 2: `final-human-comments.json`

One entry per finding that has a file and a line.

```json
{
  "comments": [
    {
      "path": "<repo-relative path>",
      "line": 42,
      "start_line": 38,
      "side": "RIGHT",
      "severity": "blocking",
      "body": "<one direct sentence (+ snippet if it is the fix)>"
    }
  ]
}
```

- `path` (string, required): repo-relative, no leading `./` or `/`.
- `line` (integer, required): line in the NEW version of the file (head side). For a range, the LAST line.
- `start_line` (integer, optional): first line of a multi-line range; omit for a single line. Must be less than `line`.
- `side` (string, required): always `"RIGHT"`.
- `severity` (required): `"blocking"` | `"should_fix"` | `"optional"` | `"nit"`.
- `body` (string, required): the comment in the voice above — up to ~100 words, understandable without the review (quality over brevity): what the code does, what it conflicts with, the ask — plus a snippet when the snippet is the fix, without a severity label prefix. Markdown allowed. The JSON must be valid (escape quotes and newlines).

Example (posting language `en`):

```json
{
  "comments": [
    {
      "path": "src/orders/total.ts",
      "line": 57,
      "side": "RIGHT",
      "severity": "blocking",
      "body": "This blocks the merge: an empty `items` makes `reduce` throw and leaves the order half-created. Give it an initial value:\n\n```ts\nconst total = items.reduce((sum, i) => sum + i.price, 0)\n```"
    },
    {
      "path": "src/orders/total.ts",
      "line": 80,
      "start_line": 72,
      "side": "RIGHT",
      "severity": "should_fix",
      "body": "Discount math and receipt formatting in the same block? Split them so each one can be tested alone."
    },
    {
      "path": "src/orders/format.ts",
      "line": 12,
      "side": "RIGHT",
      "severity": "nit",
      "body": "4 lines of comments for an if? The condition already says it."
    }
  ]
}
```

Example `final-human.md` (posting language `en`), for the comments above:

```markdown
Net improvement, GJ! The empty-order case blocks the merge (inline).
```

With a finding that has no file or line:

```markdown
LGTM but a couple of leftovers inline.

Not blocking: which call-record field should keep the caller's literal wording — first answer or last?
```

---

**Reference**
- Use `/ocr-post` to post the translated review to GitHub
- Use `/ocr-show` to view the original synthesized review
