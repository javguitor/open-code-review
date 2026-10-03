# Output Language Policy

Applies when `language` in `.ocr/config.yaml` is not `en`. The Tech Lead substitutes `{language}` with the configured tag when building each task.

## Output Language

Write all prose in **{language}**: summaries, explanations, issue descriptions, why-it-matters, suggestions, questions, discourse reasoning, synthesis narrative, chat answers. Use the natural register of that language (do not transliterate English fillers such as "tbh"/"fwiw"; use their equivalents or drop them).

Keep the following **exactly as written in English** — tools parse them:
- Section headings: `## Summary`, `## What I Explored`, `## Requirements Assessment`, `## Findings`, `### Finding N: <title>`, `## What's Working Well`, `## Clarifying Questions`, `## Questions for Other Reviewers`, `## Verdict`, `## Blockers`, `## Should Fix`, `## Suggestions`, `## Consensus & Dissent`, `## Individual Reviews`, `## Discourse from <reviewer>`, and map headings/table columns.
- Field labels: `Severity`, `Location`, `File`, `Lines`, `Issue`, `Why It Matters`, `Suggestion`, `Requirements Impact`, `Flagged by`, `Type`, `Date`, `Reviewers`, `Mode`.
- Vocabularies: verdicts `APPROVE` / `REQUEST CHANGES` / `NEEDS DISCUSSION`; severities `Critical` / `High` / `Medium` / `Low` / `Info`; categories `blocker` / `should_fix` / `suggestion` / `style`; discourse verbs `AGREE` / `CHALLENGE` / `CONNECT` / `SURFACE`; status words `Met` / `Partially Met` / `Not Met` / `Cannot Assess`.
- Code, file paths, identifiers, commands, JSON keys and values, and quoted error messages.

Finding titles (the text after `### Finding N:`) and section bodies are prose and follow {language}.

When the language is `en`, omit this policy entirely — prompts must stay byte-identical to the English defaults.
