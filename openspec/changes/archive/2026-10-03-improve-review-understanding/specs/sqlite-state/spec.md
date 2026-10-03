## ADDED Requirements

### Requirement: Posted Round Is Recorded

The `review_rounds` table SHALL have nullable columns `posted_at`, `posted_url` and `posted_state` (schema migration 20). `posted_state` SHALL be one of `approve`, `request-changes`, `comment` and hold the state actually sent to GitHub, after any own-PR downgrade. A state function SHALL record a post for a given session and round. Rounds never posted, and rounds created before the migration, SHALL have all three columns NULL.

#### Scenario: Post recorded

- **WHEN** a round is marked posted with a URL and state `comment`
- **THEN** its row SHALL hold a non-null `posted_at`, that URL and `posted_state = "comment"`

#### Scenario: Migration keeps existing rounds

- **GIVEN** a database at schema version 19 with review rounds
- **WHEN** migrations run
- **THEN** every round SHALL remain with `posted_at`, `posted_url` and `posted_state` NULL
