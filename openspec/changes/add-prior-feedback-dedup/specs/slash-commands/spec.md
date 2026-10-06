## ADDED Requirements

### Requirement: Human Review Skips Already-Reported Feedback

The human-voice translation SHALL NOT post as an inline comment any synthesized finding whose prior status is `open`; an `open` blocker SHALL get one line in `final-human.md` linking the original feedback, and an `open` non-blocking finding SHALL NOT be posted at all. A `resolved_still_present` finding SHALL be posted and cite the original; `new` and `changed` findings are posted as usual.

#### Scenario: Open non-blocking point is not repeated

- **GIVEN** a `should_fix` finding with `prior.status: "open"`
- **WHEN** the human review is generated
- **THEN** it SHALL appear neither in `final-human-comments.json` nor in `final-human.md`

#### Scenario: Open blocker is a one-line reminder

- **GIVEN** a blocker with `prior.status: "open"` and a ref URL
- **WHEN** the human review is generated
- **THEN** `final-human.md` SHALL contain one line saying it still blocks, with the link, and no inline comment for it

#### Scenario: Marked fixed but still present

- **GIVEN** a finding with `prior.status: "resolved_still_present"`
- **WHEN** the human review is generated
- **THEN** its inline comment SHALL say it is still present and link the original
