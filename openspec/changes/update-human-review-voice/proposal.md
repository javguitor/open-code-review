# Change: Terse senior-reviewer voice for the human-voice review

## Why

The human-voice review that gets posted to GitHub currently follows a didactic PR-review guide: first person plural, a "what is good" list, why + how + example for every point, a localized severity label on every comment and a closing offer of a sync call. In practice it reads long and soft. The team the fork is used with reviews in a different register — one short line per finding, praise only when earned and in one line, explicit about what blocks the merge — modelled on a senior AIR/VART reviewer's habits (the `felix-laguna` reviewer persona in the user's smith workspace).

## What Changes

- The `translate-review-to-single-human` command's voice is replaced by a terse senior-reviewer voice:
  - one direct comment per finding, up to about 100 words (quality over length), self-contained (what the code does, what it conflicts with, the ask) — no causal chain, no review-internal shorthand (a snippet only when it is the fix itself); rhetorical questions with mild irony are allowed when they make the point faster ("4 lines of comments for an if?"), never sarcasm aimed at the person;
  - praise first, in one line, only when earned; no list of what is fine and no restating of the PR description;
  - explicit about blocking in plain words ("This blocks the merge: …", "LGTM but …", "Not blocking: …") instead of fixed severity labels;
  - when blocking on design, the fix is named in one sentence; when unsure, ask instead of asserting and say what to check.
- **No fixed severity labels** at the start of comment bodies. The JSON `severity` field stays (the dashboard uses it for badges and for grouping comments that cannot go inline).
- `final-human.md` becomes a one-line verdict (praise first when earned, saying what blocks); only findings without a file or line follow it. Points with an inline comment are not repeated in the summary (the dashboard already moves comments that cannot go inline into the body). No "what is good" section, no closing sync offer.
- Unchanged: posting language, preserving every finding with its file/line, the JSON schema, and the absolute don'ts (no AI/agents/reviewers/rounds/OCR/`.ocr/` mentions, no internal overview or Mermaid).

## Impact

- Affected specs: `slash-commands` (Translate Review to Human Command, Human-Voice Review Translation, Posting Language for the Human-Voice Review)
- Affected code: `packages/agents/commands/translate-review-to-single-human.md` (synced to `.ocr/` with `nx run cli:update`; consumer repos get it with `ocr update --commands`). No dashboard code change: it reads `severity` from the JSON, never the label text.
- Behavior change for every repo using the fork's human-voice review (accepted: the fork is single-team).
