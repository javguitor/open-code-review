## MODIFIED Requirements

### Requirement: Translate Review to Human Command

The system SHALL provide a mechanism to translate multi-reviewer synthesis into a single human-voice PR comment.

#### Scenario: Invocation
- **GIVEN** a completed review round exists
- **WHEN** the translate operation is triggered from the dashboard "Post to GitHub" flow
- **THEN** it SHALL execute as part of that flow, not as a standalone slash command

#### Scenario: Input
- **GIVEN** the translate operation is triggered
- **WHEN** it reads source material
- **THEN** it SHALL read `final.md` and all reviewer output files from the round directory

#### Scenario: Output
- **GIVEN** the translate operation completes
- **WHEN** the result is produced
- **THEN** it SHALL produce a GitHub-flavored markdown comment that reads as if written by a single senior human reviewer, in the terse voice defined by "Human-Voice Review Translation"

### Requirement: Human-Voice Review Translation

The translate-review command SHALL rewrite a multi-reviewer review as a single human-voice PR review in a terse senior-reviewer voice: one short, direct comment per finding of about 35 words at most that is understandable without the review — what the code does, what it conflicts with, and the ask, without the causal chain (a snippet only when it is the fix itself; a rhetorical question with mild irony is allowed when it makes the point faster, never aimed at the person); praise first and in one line, only when earned; no list of what is fine and no restating of the PR description; explicit in plain words about what blocks the merge and what does not; the fix named in one sentence when blocking on design; a question instead of an assertion when unsure. The output SHALL NOT mention AI, agents, reviewer handles, rounds, sessions, OCR, tooling, or paths under `.ocr/`. It SHALL write two files in the round directory:

- `final-human.md`: a one-line verdict (praise first when earned) saying what blocks the merge, followed only by findings that have no file or line (one line each); it SHALL NOT repeat points that have an inline comment; no "what is good" section, no closing sync offer, no reviewer tables or consensus sections.
- `final-human-comments.json`: `{ "comments": [ { path, line, start_line?, side: "RIGHT", severity, body } ] }`, one entry per finding with a file and line, where `line` is on the new (head) side and `severity` is `blocking`, `should_fix`, `optional` or `nit`.

Comment bodies SHALL NOT start with a fixed severity label; whether a point blocks the merge SHALL be stated in the text itself.

#### Scenario: Spanish review

- **GIVEN** the posting language is `es`
- **WHEN** the command runs on a completed round
- **THEN** both files SHALL be written in Spanish with no English fillers, in the same terse voice

#### Scenario: Terse comments

- **GIVEN** a completed round with blocking and non-blocking findings
- **WHEN** the command runs
- **THEN** each comment body SHALL be short (about 35 words at most) and self-contained: what the code does, what it conflicts with and the ask, without shorthand that only makes sense inside the review (plus a snippet only when it is the fix)
- **AND** blocking comments SHALL say in plain words that they block the merge
- **AND** no body SHALL start with `Blocking:`, `Should fix:`, `Optional:`, `Bloqueante:`, `Importante:` or `Opcional:`

#### Scenario: Summary without filler

- **WHEN** `final-human.md` is written
- **THEN** it SHALL be a one-line verdict, with no "what is good" list and no closing sync offer
- **AND** it SHALL NOT list any finding that has an inline comment; only findings without a file or line follow the verdict

#### Scenario: Finding without a line

- **WHEN** a finding has no file or line
- **THEN** it SHALL appear in `final-human.md` only, not in `final-human-comments.json`

### Requirement: Posting Language for the Human-Voice Review

The human-voice translation SHALL write the summary, the inline comments and the "Other comments" heading in the posting language (`posting.language`, else `language`), read from the `Posting language:` line of its prompt or from `.ocr/config.yaml`. The internal review SHALL keep using `language`.

#### Scenario: Different posting language

- **GIVEN** `language: es` and `posting.language: en`
- **WHEN** the human-voice review is generated
- **THEN** its text SHALL be in English
