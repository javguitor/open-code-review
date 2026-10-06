## MODIFIED Requirements

### Requirement: Final Review Synthesis

The system SHALL synthesize individual reviews and discourse into a prioritized final review.

The review verdict SHALL be drawn from a closed, canonical 3-state vocabulary representing the **merge gate** only: `APPROVE` (mergeable), `REQUEST CHANGES` (blocked on required work), or `NEEDS DISCUSSION` (undecided pending a human question). Residual work — follow-ups and suggestions — SHALL NOT be expressed as verdict states; it is carried by finding **category** (`blocker / should_fix / suggestion / style`) and the derived per-round counts. The synthesizer SHALL NOT emit composite or off-vocabulary verdicts (e.g. `accept_with_followups`, `approve_with_suggestions`).

The synthesizer SHALL choose the verdict and the `blocker`-category findings **together** so they point the same direction, measured by the deduplicated blocker count (`resolveRoundCounts().blockerCount`, which honors `synthesis_counts.blockers`): it SHALL emit `REQUEST CHANGES` only when the blocker count is ≥ 1, SHALL emit `APPROVE` only when the blocker count is 0, and MAY emit `NEEDS DISCUSSION` regardless of blocker count. "Blocker" is exactly the canonical `blocker` category; `should_fix`/`suggestion`/`style` are residual work and never force `REQUEST CHANGES`. This keeps the merge gate and the findings as one consistent view, so the CLI's directional verdict ↔ blocker-count check is a backstop rather than the first line of defense.

#### Scenario: Confidence weighting
- **GIVEN** findings from multiple sources
- **WHEN** synthesis occurs
- **THEN** findings SHALL be weighted by:
  1. Redundancy consensus (found by multiple runs)
  2. Cross-reviewer consensus (found by different reviewers)
  3. Discourse confirmation
  4. Severity

#### Scenario: Deduplication
- **GIVEN** the same issue found by multiple reviewers
- **WHEN** synthesis occurs
- **THEN** the issue SHALL appear once with sources noted

#### Scenario: Final review structure
- **GIVEN** synthesis is complete
- **WHEN** final review is generated
- **THEN** it SHALL include, in this order:
  - `## What This Change Does` (the task, how it was built step by step, 1–2 diagrams)
  - `## Verdict` with the verdict value, the count lines and a short plain explanation
  - `## Blockers`, `## Should Fix`, `## Suggestions` with each problem told in plain language
  - `## What's Working Well`
  - `## Clarifying Questions` (when there are any)

#### Scenario: Verdict is a closed merge-gate vocabulary
- **GIVEN** synthesis is complete and an outcome must be recorded
- **WHEN** the verdict is chosen
- **THEN** it SHALL be exactly one of `APPROVE`, `REQUEST CHANGES`, or `NEEDS DISCUSSION`
- **AND** the presence of non-blocking residual work (follow-ups, suggestions) SHALL NOT change the verdict away from `APPROVE`
- **AND** that residual work SHALL be represented as findings with category `should_fix`, `suggestion`, or `style`

#### Scenario: Verdict and blocker findings are chosen consistently
- **GIVEN** synthesis has produced the final finding set
- **WHEN** the verdict is chosen
- **THEN** `REQUEST CHANGES` SHALL be emitted only if the deduplicated blocker count is ≥ 1
- **AND** `APPROVE` SHALL be emitted only if the deduplicated blocker count is 0
- **AND** `NEEDS DISCUSSION` MAY be emitted regardless of the blocker count

### Requirement: Plain-Language Overview in the Final Review

`final.md` SHALL open, right after its header block and before `## Verdict`, with a `## What This Change Does` section for a reader who has not read the diff, containing `**What the task asks**`, `**How it was built, step by step**` (numbered steps in the logical order of the implementation) and one or two Mermaid diagrams. The heading SHALL stay in English; the bold labels and prose follow the output language.

#### Scenario: Overview precedes the verdict

- **WHEN** the Tech Lead writes `final.md`
- **THEN** `## What This Change Does` SHALL appear before `## Verdict`

#### Scenario: What the task asks

- **WHEN** the overview is written
- **THEN** `**What the task asks**` SHALL state the goal in plain words, from the requirements or card when present, otherwise inferred from the PR description

#### Scenario: Step by step in implementation order

- **WHEN** the overview is written
- **THEN** `**How it was built, step by step**` SHALL be a numbered list that starts from the base the rest depends on (data, contracts, types), then the logic that uses it, then where it connects (commands, API), then what the user sees
- **AND** each step SHALL say in one to three sentences what was added or changed and why the next step needs it, mentioning files only in passing

#### Scenario: One or two diagrams

- **WHEN** the overview is written
- **THEN** it SHALL contain one Mermaid diagram of the flow (at most about 12 nodes or messages, plain-word labels, no HTML, no `click` directives)
- **AND** it MAY add a second one (a `sequenceDiagram`, or a before → after view) only when several components interact or an existing flow changes

#### Scenario: Heading kept in English

- **GIVEN** the configured language is `es`
- **WHEN** `final.md` is written
- **THEN** the heading SHALL read `## What This Change Does`
- **AND** the section prose SHALL be in Spanish

#### Scenario: Existing parsers unaffected

- **GIVEN** a `final.md` with the overview section before the verdict
- **WHEN** it is parsed for verdict and counts
- **THEN** the verdict and the blocker, should-fix and suggestion counts SHALL be the same as without the section

## ADDED Requirements

### Requirement: Final Review Without Process Details

`final.md` SHALL tell each problem in plain language and SHALL NOT contain details of the review process: no reviewer handles, no `**Reviewers**` or `**Flagged by**` lines, no consensus, dissent or discourse sections, no per-reviewer grouping. Each finding ends with one line holding its location and `**ID**: S<n>`. Provenance stays in `round-meta.json` and the dashboard.

#### Scenario: Problem told in plain language

- **WHEN** a finding is written under `## Blockers`, `## Should Fix` or `## Suggestions`
- **THEN** it SHALL have a plain title and one or two paragraphs saying what happens, why it matters and what to do, with any evidence woven into the prose
- **AND** it SHALL NOT use form fields such as `**Type**`, `**Issue**`, `**Why this blocks**` or `**Evidence**`

#### Scenario: No process sections

- **WHEN** `final.md` is written
- **THEN** it SHALL contain no `@reviewer` handle, no `## Consensus & Dissent`, no `## Individual Reviews` and no reference to the discourse

#### Scenario: Keys still link to the dashboard

- **WHEN** a finding is written
- **THEN** it SHALL end with a line holding its location and `**ID**: S<n>` (or the `[S<n>]` prefix for a suggestion bullet), so each item still maps to its synthesized finding
