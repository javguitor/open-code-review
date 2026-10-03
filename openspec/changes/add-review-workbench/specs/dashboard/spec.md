## ADDED Requirements

### Requirement: Diff Endpoint

The dashboard server SHALL serve the reviewed diff of a round, parsed into files, hunks and lines, from the `diff.patch` artifact, and SHALL serve read-only file context from the session's code root.

#### Scenario: Parsed diff

- **GIVEN** a round with a `diff` artifact
- **WHEN** the client requests `GET /api/sessions/:id/rounds/:n/diff`
- **THEN** the response lists each file with its status (added, deleted, modified, renamed, binary) and hunks with old/new line numbers per line

#### Scenario: Large diff

- **GIVEN** a diff with more than 200 files or 20,000 lines
- **WHEN** the client requests the round diff
- **THEN** the response contains the file list only and each file's hunks are served on demand with `?file=<path>`

#### Scenario: No diff saved

- **GIVEN** a round without a `diff` artifact (older session)
- **WHEN** the client requests the round diff
- **THEN** the response is `404` with a message the workbench shows as "Diff not saved for this round"

#### Scenario: File context stays inside the code root

- **WHEN** the client requests `GET …/file?path=../x&from=1&to=20`
- **THEN** the server rejects the path with `400`; a path inside the code root returns the requested line range

### Requirement: Review Workbench

The dashboard SHALL provide a workbench view per round with three zones: files touched, the diff with finding markers, and the selected finding with its decision.

#### Scenario: Navigate by file and finding

- **GIVEN** a round with a diff and findings
- **WHEN** the workbench opens
- **THEN** the file list shows each file with added/removed counts and the number of findings; selecting a file shows its unified diff with a marker on each finding's first line; clicking a marker selects the finding

#### Scenario: Selected finding panel

- **WHEN** a finding is selected
- **THEN** the panel shows title, current severity and category (with "synthesis: X" when revised), who flagged it, summary, evidence, verification status and note, decision controls, notes, revision history and "Ask about this finding"

#### Scenario: Diff not saved

- **GIVEN** a round without a diff artifact
- **WHEN** the workbench opens
- **THEN** the files and diff zones show "Diff not saved for this round" and the finding panel still works

#### Scenario: Previous-round hint

- **GIVEN** round N+1 and a finding whose file path and title match a round-N finding that was dismissed with a reason
- **WHEN** the finding is selected
- **THEN** the panel shows "Previous round: dismissed — <reason>" without changing the current decision

### Requirement: Finding Decisions

The dashboard SHALL record human decisions per finding with a reason, and SHALL never apply a change to a finding without a user action.

#### Scenario: Confirm, fix, dismiss

- **WHEN** the user clicks Confirm, Mark fixed, or Dismiss (with a reason of at least 10 characters)
- **THEN** `user_finding_progress` stores `confirmed`, `fixed` or `dismissed` with the reason and `decided_at`, and a `finding_revisions` row with `source: user` is written

#### Scenario: Reason required

- **WHEN** the user tries to dismiss or mark won't-fix without a reason
- **THEN** the dialog refuses and nothing is written

#### Scenario: Counts follow current values

- **GIVEN** a finding whose severity was revised from high to low
- **WHEN** the round page renders
- **THEN** counts use the current values and the original synthesis counts remain available from `round-meta.json`

#### Scenario: No automatic fix

- **WHEN** the workbench renders a finding
- **THEN** no action applies code changes; the primary actions are Confirm, Dismiss with reason, Mark fixed and Request verification

#### Scenario: Verdict after decisions

- **GIVEN** a round with a synthesis verdict
- **WHEN** no live finding has a resolving decision (dismissed, wont_fix, fixed) or a category revised away from the synthesis
- **THEN** the verdict after decisions equals the synthesis verdict
- **AND** otherwise it is REQUEST CHANGES while any live blocker stays open, else APPROVE, except that NEEDS DISCUSSION is never turned into APPROVE

#### Scenario: Retired findings in the workbench

- **GIVEN** a finding that left the synthesis and was kept as retired
- **WHEN** the workbench or round page renders
- **THEN** it is shown greyed with a "retired" badge, excluded from every count and from keyboard navigation, and offers no decision, verification, "Ask about this finding" or chat proposal Apply

### Requirement: Chat Proposals

Ask the Team answers MAY propose a change to a finding; the dashboard SHALL render proposals as cards that the user applies or discards, and SHALL never apply them automatically.

#### Scenario: Valid proposal rendered

- **GIVEN** a chat answer containing a fenced `ocr-proposal` JSON block with a finding id of this round, allowed enum values and a reason
- **WHEN** the message renders
- **THEN** a proposal card shows the proposed change and reason with Apply and Discard

#### Scenario: Apply writes a revision

- **WHEN** the user clicks Apply
- **THEN** the finding is updated and a `finding_revisions` row with `source: chat`, the reason and the conversation id is written

#### Scenario: Invalid proposal ignored

- **GIVEN** a block with an unknown finding id, an invalid value or a missing reason
- **WHEN** the message renders
- **THEN** it is shown as plain text and no Apply control exists

### Requirement: Verification Request

The dashboard SHALL let the user request verification of a finding and show the verifier's outcome.

#### Scenario: Request verification

- **WHEN** the user clicks "Request verification"
- **THEN** the `verify <finding-id>` command runs as a tracked execution visible in Commands
- **AND** when it completes, the finding shows `reproduced`, `supported`, `pending` or `dismissed` with the verifier's note and a link to the verification file
