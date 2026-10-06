## ADDED Requirements

### Requirement: Already-Reported Badge

The dashboard SHALL show, on each synthesized finding with a prior status other than `new`, an "Already reported" badge naming the status (still open, marked fixed but still present, code changed) and linking each original feedback item.

#### Scenario: Badge with links

- **GIVEN** a synthesized finding with `prior.status: "open"` and a GitHub thread ref
- **WHEN** the round page lists the finding
- **THEN** it SHALL show the badge with the status and a link to the thread

#### Scenario: New findings unchanged

- **WHEN** a finding has no prior or `prior.status: "new"`
- **THEN** no badge SHALL be shown
