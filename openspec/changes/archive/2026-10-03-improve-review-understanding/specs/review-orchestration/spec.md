## ADDED Requirements

### Requirement: Plain-Language Overview in the Final Review

`final.md` SHALL open, right after its header block and before `## Verdict`, with a `## What This Change Does` section for a reader who has not read the diff. It SHALL contain a `**What the task asks**` part (from the requirements or card when present; otherwise what the change is for, inferred from the PR description), a `**What the PR implements**` part (the behaviour change in plain words, without a file-by-file walk), and one Mermaid diagram (`sequenceDiagram` for interactions over time, `flowchart` for a decision or workflow) of at most about 12 nodes or messages, with plain-word labels, no HTML and no `click` directives. A second "before → after" diagram MAY be added only when the change alters an existing flow. The section SHALL stay under about 25 lines. The heading SHALL stay in English whatever the output language; the bold labels and prose follow the language.

#### Scenario: Overview precedes the verdict

- **WHEN** the Tech Lead writes `final.md`
- **THEN** `## What This Change Does` SHALL appear before `## Verdict`
- **AND** it SHALL contain exactly one `mermaid` diagram unless the change alters an existing flow

#### Scenario: Heading kept in English

- **GIVEN** the configured language is `es`
- **WHEN** `final.md` is written
- **THEN** the heading SHALL read `## What This Change Does`
- **AND** the section prose SHALL be in Spanish

#### Scenario: Existing parsers unaffected

- **GIVEN** a `final.md` with the overview section before the verdict
- **WHEN** it is parsed for verdict and counts
- **THEN** the verdict and the blocker, should-fix and suggestion counts SHALL be the same as without the section
