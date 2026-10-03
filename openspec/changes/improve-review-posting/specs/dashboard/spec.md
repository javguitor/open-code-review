## ADDED Requirements

### Requirement: PR Author Display

The dashboard SHALL show the PR author (`@login`, linking to the GitHub profile) in the session detail PR block, the session card and the reviews list. For PR sessions with no recorded author it MAY look the author up with `gh pr view`, cached, and SHALL NOT block list rendering on that lookup.

#### Scenario: Author shown

- **GIVEN** a PR session with `pr_author = "octocat"`
- **WHEN** the session detail is opened
- **THEN** `@octocat` SHALL be shown linking to `https://github.com/octocat`

### Requirement: Human Review Preview and Inline Posting

The dashboard SHALL offer a preview of the review to post (`post:preview`) returning the body, the comments that map to lines of the round's diff (`inline`), and the rest (`moved`). The body SHALL be `final-human.md` when present, else `final.md`; moved comments SHALL be appended to the body under a localized heading (es "Otros comentarios", en "Other comments"). `post:submit` SHALL accept `useHuman` and `inline`; with inline comments on a PR session it SHALL publish ONE review (`gh api` POST `pulls/<n>/reviews`) carrying the body and the comments; otherwise it SHALL keep posting the body with `gh pr review`. The human review SHALL be the primary path; the team version SHALL remain available.

#### Scenario: Comment outside the diff

- **GIVEN** a comment whose line is not in any hunk of the round's diff
- **WHEN** the review is previewed and posted
- **THEN** it SHALL be listed under `moved` and appended to the body
- **AND** it SHALL NOT be sent as an inline comment

#### Scenario: One review with inline comments

- **GIVEN** a PR session with mappable comments and `inline` enabled
- **WHEN** the user publishes
- **THEN** a single review request SHALL be sent containing the body and all inline comments
