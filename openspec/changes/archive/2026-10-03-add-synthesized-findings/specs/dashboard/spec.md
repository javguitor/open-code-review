## ADDED Requirements

### Requirement: Synthesized Findings in Rounds

For a round that uses synthesis, the dashboard SHALL treat the synthesized finding as the unit of triage: the findings list, the diff markers, decisions, verification, revisions, chat proposals, round counts and the verdict after decisions SHALL operate on synthesized findings, and the reviewer findings SHALL be shown as read-only provenance. Rounds that do not use synthesis SHALL keep the per-reviewer-row behaviour, including the "also reported by" links and the per-reviewer-row counts label.

#### Scenario: One decision for a merged problem

- **GIVEN** a round where four reviewer findings are merged into one synthesized blocker
- **WHEN** the user dismisses it with a reason
- **THEN** one decision is stored, the blocker count drops to 0 and the verdict after decisions updates, without any other row to decide

#### Scenario: Reviewer findings are provenance

- **WHEN** a synthesized finding is selected
- **THEN** the panel shows a read-only "Merged from N reviewer findings" section with each source's reviewer handle, original title, severity, category, location and summary
- **AND** no decision, verification or revision control exists on a source row

#### Scenario: Provenance is read-only on every write path

- **GIVEN** a round that uses synthesis
- **WHEN** a decision, revision, verification or chat proposal is addressed to a reviewer finding of that round (HTTP route, `ocr finding verify|revise --id`, or the `verify <id>` command)
- **THEN** it is refused with the code `synthesized-round` (HTTP 409) and nothing is written
- **AND** a round whose synthesized rows are all retired is a legacy round again, so its reviewer rows are writable

#### Scenario: Legacy round unchanged

- **GIVEN** a round whose `round-meta.json` has no `synthesis_findings`
- **WHEN** the round page or workbench renders
- **THEN** it lists reviewer findings, shows "also reported by" and the per-reviewer-row counts label, and decides each row separately, exactly as before this change

#### Scenario: Reviewer page links to the synthesized finding

- **WHEN** the reviewer detail page lists a reviewer's findings in a synthesized round
- **THEN** each finding links to the synthesized finding that merged it and shows that finding's decision status, and the reviewer's own counts are labelled as that reviewer's findings

#### Scenario: Earlier decisions on reviewer copies are a hint

- **GIVEN** a round that gained synthesized findings after a source reviewer finding had been decided
- **WHEN** the synthesized finding is selected
- **THEN** the "Merged from" section shows "Decided earlier on this copy" with the status and reason, and the synthesized finding stays undecided until the user acts

#### Scenario: Counts follow the synthesized findings

- **GIVEN** a synthesized round with 14 synthesized findings merging 34 reviewer findings
- **WHEN** the round page renders
- **THEN** its counts and open counts are over the 14 live synthesized findings on current values

## MODIFIED Requirements

### Requirement: Review Workbench

The dashboard SHALL provide a workbench view per round with three zones: files touched, the diff with finding markers, and the selected finding with its decision. In a round that uses synthesis the findings are the synthesized findings; otherwise they are the reviewer findings.

#### Scenario: Navigate by file and finding

- **GIVEN** a round with a diff and findings
- **WHEN** the workbench opens
- **THEN** the file list shows each file with added/removed counts and the number of findings; selecting a file shows its unified diff with a marker on each finding's first line; clicking a marker selects the finding
- **AND** a synthesized finding is marked at its primary location and counted under that file, and its other locations are listed in the panel

#### Scenario: Selected finding panel

- **WHEN** a finding is selected
- **THEN** the panel shows title, current severity and category (with "synthesis: X" when revised), who flagged it, summary, evidence, verification status and note, decision controls, notes, revision history and "Ask about this finding"
- **AND** for a synthesized finding it also shows every location and the read-only "Merged from N reviewer findings" section

#### Scenario: Diff not saved

- **GIVEN** a round without a diff artifact
- **WHEN** the workbench opens
- **THEN** the files and diff zones show "Diff not saved for this round" and the finding panel still works

#### Scenario: Previous-round hint

- **GIVEN** round N+1 and a finding whose file path and title match a round-N finding that was dismissed with a reason
- **WHEN** the finding is selected
- **THEN** the panel shows "Previous round: dismissed — <reason>" without changing the current decision

#### Scenario: Previous-round hint between synthesized findings

- **GIVEN** round N+1 uses synthesis and a synthesized finding has a location on the same file as a dismissed synthesized finding of round N, with a similar title or an overlapping line range
- **WHEN** the finding is selected
- **THEN** the panel shows the same "Previous round: dismissed — <reason>" hint without changing the current decision

#### Scenario: Previous round without synthesis

- **GIVEN** round N+1 uses synthesis and round N does not
- **WHEN** a synthesized finding is selected
- **THEN** the hint compares the finding's title and its sources' titles with round N's decided reviewer findings on the same file, using the same similarity threshold

### Requirement: Finding Decisions

The dashboard SHALL record human decisions per finding with a reason, and SHALL never apply a change to a finding without a user action. The finding is the synthesized finding in a round that uses synthesis, and the reviewer finding otherwise.

#### Scenario: Confirm, fix, dismiss

- **WHEN** the user clicks Confirm, Mark fixed, or Dismiss (with a reason of at least 10 characters)
- **THEN** the decision store of the finding's kind (`user_finding_progress` for reviewer findings, `synthesis_finding_decisions` for synthesized findings) stores `confirmed`, `fixed` or `dismissed` with the reason and `decided_at`, and a revision row of the same kind with `source: user` is written

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
- **AND** in a round that uses synthesis, "live finding" and "blocker" refer to synthesized findings only

#### Scenario: Retired findings in the workbench

- **GIVEN** a finding that left the synthesis and was kept as retired
- **WHEN** the workbench or round page renders
- **THEN** it is shown greyed with a "retired" badge, excluded from every count and from keyboard navigation, and offers no decision, verification, "Ask about this finding" or chat proposal Apply

### Requirement: Chat Proposals

Ask the Team answers MAY propose a change to a finding; the dashboard SHALL render proposals as cards that the user applies or discards, and SHALL never apply them automatically. In a round that uses synthesis the chat context lists the synthesized findings and a proposal's finding id refers to a synthesized finding of that round; otherwise it refers to a reviewer finding.

#### Scenario: Valid proposal rendered

- **GIVEN** a chat answer containing a fenced `ocr-proposal` JSON block with a finding id of this round, allowed enum values and a reason
- **WHEN** the message renders
- **THEN** a proposal card shows the proposed change and reason with Apply and Discard

#### Scenario: Apply writes a revision

- **WHEN** the user clicks Apply
- **THEN** the finding is updated and a revision row of the finding's kind with `source: chat`, the reason and the conversation id is written

#### Scenario: Invalid proposal ignored

- **GIVEN** a block with an unknown finding id, an invalid value or a missing reason
- **WHEN** the message renders
- **THEN** it is shown as plain text and no Apply control exists

#### Scenario: Id from the wrong kind ignored

- **GIVEN** a round that uses synthesis and a block whose finding id belongs to a reviewer finding and not to a synthesized finding of this round
- **WHEN** the message renders
- **THEN** it is shown as plain text and no Apply control exists

### Requirement: Verification Request

The dashboard SHALL let the user request verification of a finding and show the verifier's outcome. In a round that uses synthesis the verification applies to the synthesized finding.

#### Scenario: Request verification

- **WHEN** the user clicks "Request verification"
- **THEN** the `verify <finding-id>` command (`verify --synthesis <id>` for a synthesized finding) runs as a tracked execution visible in Commands
- **AND** when it completes, the finding shows `reproduced`, `supported`, `pending` or `dismissed` with the verifier's note and a link to the verification file

#### Scenario: Ambiguous verify arguments refused

- **WHEN** a `verify` command carries both a plain id and `--synthesis`, or a non-positive-integer id
- **THEN** it is refused before spawning and the workbench releases the pending state of the finding
