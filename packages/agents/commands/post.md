---
description: Post the current OCR review to a GitHub PR.
name: "OCR: Post"
category: Code Review
tags: [ocr, github, pr]
---

**Usage**
```
/ocr-post [session] [--human-translated-review <path>] [--state <approve|request-changes|comment>]
```

**Arguments**
- `session` (optional): Session ID to post. Defaults to most recent.
- `--human-translated-review <path>` (optional): Explicit path to a human-translated review file to post instead of `final.md`.
- `--state <approve|request-changes|comment>` (optional): Review state to submit on the PR. Without it, the state is derived from the round verdict (see table below).

**Review state**

The verdict comes from `ocr state show` (current round verdict) or, if unavailable, from `rounds/round-{current_round}/round-meta.json` -> `verdict`.

| Round verdict       | Review state      |
|---------------------|-------------------|
| `APPROVE`           | `approve`         |
| `REQUEST CHANGES`   | `request-changes` |
| `NEEDS DISCUSSION`  | `comment`         |
| no verdict          | `comment`         |

An explicit `--state` always wins over the derived state.

The posted comment is written in the `language` set in `.ocr/config.yaml` (default `en`), in that language's natural register.

**Prerequisites**
- GitHub CLI (`gh`) must be installed and authenticated
- Must be on a branch with an open PR

**Steps**

1. Verify `gh` is available and authenticated
2. Find the PR for current branch
3. Determine current round from `ocr state show` -> `current_round` (or enumerate `rounds/` directory)
4. **Select the review content to post** (in priority order):
   a. If `--human-translated-review <path>` is provided, use that file
   b. Otherwise, check if `rounds/round-{current_round}/final-human.md` exists -- if yes, prefer it
   c. Fall back to `rounds/round-{current_round}/final.md`
5. **Resolve the review state**: use `--state` if given; otherwise derive it from the round verdict using the table above
6. Post as a PR review: `gh pr review {number} --{state} --body-file {file}`
7. `gh pr review` prints nothing on success. To show the user a link, run `gh api repos/{owner}/{repo}/pulls/{number}/reviews --jq '.[-1].html_url'` (best effort; if it fails, just say the review was posted)

**Own pull request**

GitHub rejects `--approve` and `--request-changes` on the invoking user's own PR, failing with `GraphQL: Review Can not approve your own pull request` or `GraphQL: Review Can not request changes on your own pull request`. On that exact failure, re-run the command with `--comment` and tell the user that the state was downgraded to `comment` and why (GitHub does not allow approving or requesting changes on your own PR). Any other failure is reported as-is, with no retry.

**Convention Over Configuration**

When no `--human-translated-review` flag is given, the post command automatically checks for a human-translated review before falling back to the raw synthesized review. This means if you've run `/ocr-translate-review-to-single-human` beforehand, the translated version is picked up without any extra flags.

The explicit `--human-translated-review` flag overrides this auto-detection and lets you point to any arbitrary file.

**Reference**
- Run `/ocr-translate-review-to-single-human` to generate a human-voice translation before posting
- Run `/ocr-doctor` to check GitHub CLI status
