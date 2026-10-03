---
description: Translate a multi-reviewer code review into a single human-voice PR review (summary + inline comments).
name: "OCR: Translate Review to Single Human"
category: Code Review
tags: [ocr, post, github, human-voice]
---

**Usage**
```
/ocr-translate-review-to-single-human [session] [--round <N>]
```

**Arguments**
- `session` (optional): Session ID to translate. Defaults to most recent.
- `--round <N>` (optional): Round number to translate. Defaults to current round.

**Examples**
```
/ocr-translate-review-to-single-human                        # Translate latest round of latest session
/ocr-translate-review-to-single-human --round 2              # Translate round 2
/ocr-translate-review-to-single-human 2026-03-06-feat-auth   # Translate specific session
```

**Prerequisites**
- A completed review round with `final.md` and reviewer outputs in `reviews/*.md`

**Outputs** (both in `rounds/round-{N}/`)
- `final-human.md`: the summary body of the review
- `final-human-comments.json`: the inline comments, one per finding that has a file and line

---

## Steps

1. **Locate the session and round**
   - If no session specified, find the most recent in `.ocr/sessions/`
   - Determine the round number from `ocr state show` -> `current_round`, or use `--round` if provided
   - Verify the round directory exists: `.ocr/sessions/{id}/rounds/round-{N}/`

2. **Read the source material**
   - Read `rounds/round-{N}/final.md` for the synthesized review
   - Read ALL individual reviewer outputs in `rounds/round-{N}/reviews/*.md` for raw findings (exact file and line of each finding)

3. **Apply the translation rules** below

4. **Write BOTH output files** in the same round directory: `final-human.md` and `final-human-comments.json`

---

## Translation Rules

You are rewriting a multi-reviewer review into ONE pull-request review that reads as if a single teammate wrote it after reading the code carefully. The goal is a review the author can act on without friction: respectful, specific, and clear about what blocks the merge and what does not.

### Language

- Write everything in the `language` set in `.ocr/config.yaml` (default `en`), following `references/language-policy.md`. Use that language's natural register for a teammate review. Do not carry over English fillers ("tbh", "fwiw", "So...", "Oh and") into other languages, and do not use gimmicks that only work in English.
- Exception to the language policy: here the severity labels ARE localized (see below). Code, paths, identifiers and JSON keys stay as they are.

### Voice (PR review guide)

- **Critique the code, never the person.** "This function mixes two responsibilities", not "you mixed...".
- **Shared ownership: first person plural.** Prefer "we" ("could we extract this?", "we lose the error here") over "you". In Spanish: "podríamos", "tenemos", not "tú/deberías".
- **Acknowledge what is good**, briefly and specifically ("the retry logic is easy to follow"). No empty praise.
- **Be actionable: why + how + example.** For each point say why it matters, how to fix it, and show a small snippet when it makes the fix obvious.
- **Didactic, not condescending.** Explain the reasoning so the author learns the criterion, not only the change.
- **Debatable points are open questions.** If a point has a reasonable alternative, say so and offer a short sync chat (a quick call or chat) instead of arguing in writing.
- Be direct. "This needs a bounds check" beats "it might be worth considering whether...".

### Severity labels

Start every inline comment body with exactly one localized label:

| `severity` (JSON) | Meaning | `es` label | `en` label |
|---|---|---|---|
| `blocking` | Must be fixed before merging: bugs, data loss, security, broken contract | `Bloqueante:` | `Blocking:` |
| `should_fix` | Should be fixed; not a merge blocker but will cause pain later | `Importante:` | `Should fix:` |
| `optional` | A better approach exists; the author may take it or leave it | `Opcional:` | `Optional:` |
| `nit` | Style, naming, minor readability | `Nit:` | `Nit:` |

Map the source categories: `blocker` -> `blocking`, `should_fix` -> `should_fix`, `suggestion` -> `optional`, `style` -> `nit`. For other languages, translate the three non-`Nit` labels naturally and keep `Nit:`.

### Content rules (NON-NEGOTIABLE)

- Preserve EVERY substantive technical finding. Do not drop or summarize away a concrete issue.
- Consolidate duplicates: if several reviewers flagged the same thing, write it once.
- Use the exact file path (repo-relative) and the line numbers of the findings. For the inline `line`, use the line in the NEW version of the file (the head side of the diff).
- A finding with no file or line goes in the summary only (not in the JSON).
- GitHub-flavored markdown.

### Absolute don'ts

The text that gets posted must NEVER contain:
- any mention of AI, agents, LLMs, automated analysis, reviewers (personas or handles such as `principal-1`, `quality-2`), "the team", rounds, sessions, consensus, OCR, or any tooling;
- file paths under `.ocr/`, session ids, or the names of these output files;
- reviewer tables, "Individual Reviews", consensus/dissent sections, or verdict banners from `final.md`;
- a mention that the text was translated or rewritten.

---

## Output 1: `final-human.md`

The summary body of the review. Keep it short; the detail lives in the inline comments.

1. A short overall assessment (1-3 sentences): what the change does well and where it stands.
2. **What is good**: 1-4 specific bullets.
3. **Blocks the merge**: ONLY if there are `blocking` findings. One line each, with the location as `` `path/to/file.ts:42` `` so the author can jump to the inline comment. If there are none, OMIT this section entirely (no heading followed by "Nothing"/"Nada") and say it once in the opening assessment (e.g. "Nothing here blocks the merge.").
4. **Does not block**: the `should_fix`, `optional` and `nit` points, grouped briefly (a few lines or one short list; no per-point essays). Group them under the same localized labels as the inline comments (`Importante` / `Opcional` / `Nit`; `Should fix` / `Optional` / `Nit`). Never describe a non-blocking point as something to fix "before merging": only `blocking` findings gate the merge.
5. A closing line offering a quick sync if something is debatable.

Do not start with "Overall, this is a...". Do not add reviewer tables, headings per reviewer, or consensus sections.

## Output 2: `final-human-comments.json`

One entry per finding that has a file and a line.

```json
{
  "comments": [
    {
      "path": "<repo-relative path>",
      "line": 42,
      "start_line": 38,
      "side": "RIGHT",
      "severity": "blocking",
      "body": "<label> <text>"
    }
  ]
}
```

- `path` (string, required): repo-relative, no leading `./` or `/`.
- `line` (integer, required): line in the NEW version of the file (head side). For a range, the LAST line.
- `start_line` (integer, optional): first line of a multi-line range; omit for a single line. Must be less than `line`.
- `side` (string, required): always `"RIGHT"`.
- `severity` (required): `"blocking"` | `"should_fix"` | `"optional"` | `"nit"`.
- `body` (string, required): starts with the localized label, then why + how (+ a snippet if useful). Markdown allowed. The JSON must be valid (escape quotes and newlines).

Example (language `es`):

```json
{
  "comments": [
    {
      "path": "src/orders/total.ts",
      "line": 57,
      "side": "RIGHT",
      "severity": "blocking",
      "body": "Bloqueante: si `items` llega vacío, `reduce` sin valor inicial lanza `TypeError` y el pedido queda a medio crear. Podríamos darle un valor inicial para que el caso vacío sea simplemente 0:\n\n```ts\nconst total = items.reduce((sum, i) => sum + i.price, 0)\n```"
    },
    {
      "path": "src/orders/total.ts",
      "line": 80,
      "start_line": 72,
      "side": "RIGHT",
      "severity": "optional",
      "body": "Opcional: este bloque mezcla el cálculo del descuento con el formato del recibo. Si lo separamos en dos funciones, cada una se puede probar sola. Es discutible según cuánto vaya a crecer, así que si prefieres lo comentamos en una llamada rápida."
    },
    {
      "path": "src/orders/format.ts",
      "line": 12,
      "side": "RIGHT",
      "severity": "nit",
      "body": "Nit: `tmp` no dice qué contiene; algo como `receiptLines` se lee mejor."
    }
  ]
}
```

Example `final-human.md` (language `es`):

```markdown
Buen cambio en general: el cálculo del total queda mucho más claro que antes y los tests cubren los casos principales. Hay un punto que conviene resolver antes de mergear.

**Lo que está bien**
- La separación entre cálculo y persistencia facilita seguir el flujo.
- Los nombres de los tests describen bien el comportamiento esperado.

**Bloquea el merge**
- `src/orders/total.ts:57`: el caso de pedido vacío lanza un error (detalle en el comentario).

**No bloquea**
- Opcional: separar el descuento del formato del recibo (`src/orders/total.ts:72-80`).
- Nit: un nombre poco descriptivo (`src/orders/format.ts:12`).

Si algún punto os parece discutible, lo hablamos en una llamada rápida y lo cerramos.
```

---

**Reference**
- Use `/ocr-post` to post the translated review to GitHub
- Use `/ocr-show` to view the original synthesized review
