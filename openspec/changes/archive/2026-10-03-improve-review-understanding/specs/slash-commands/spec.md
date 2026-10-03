## ADDED Requirements

### Requirement: Human Review Excludes the Internal Overview

The single-human translation SHALL NOT carry the `## What This Change Does` section of `final.md`, nor any Mermaid diagram, into `final-human.md` or into any inline comment. The overview is an internal explanation for the team and is never posted.

#### Scenario: Overview dropped on translation

- **GIVEN** a `final.md` with a `## What This Change Does` section and a `mermaid` block
- **WHEN** the review is translated to a single human review
- **THEN** neither the section nor the diagram SHALL appear in `final-human.md` or `final-human-comments.json`
