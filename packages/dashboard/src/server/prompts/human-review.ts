import { languagePolicy } from '@open-code-review/config/language-config'

/**
 * Prompt generator for rewriting a multi-reviewer code review
 * into a single human-voice GitHub PR comment.
 *
 * Follows Google's code review guidelines for tone and approach,
 * with specific instructions for natural human writing patterns.
 */

export function buildHumanReviewPrompt(
  finalContent: string,
  reviewerContents: { name: string; content: string }[],
  language: string,
): string {
  let prompt = `You are rewriting a multi-reviewer code review into a single PR comment that reads like one real person wrote it after carefully reading through the code. Not an AI. Not a committee. Just a developer who spent time on this and has opinions.

<final-review>
${finalContent}
</final-review>
`

  for (const reviewer of reviewerContents) {
    prompt += `
<reviewer-output name="${reviewer.name}">
${reviewer.content}
</reviewer-output>
`
  }

  prompt += `
## Your Task

Turn the above multi-reviewer analysis into a single GitHub PR comment written in YOUR voice — a senior engineer who actually sat down and read through this code.

## Voice & Tone (follow Google's code review guidelines)

- Comment on the CODE, never the developer. "This function could be simplified" not "you wrote this wrong."
- Always explain WHY something matters. Don't just say "change this" — say why it's worth changing.
- Label severity naturally: prefix minor stuff with "Nit:" or "Minor:", flag blockers clearly.
- When something is good, say so briefly. Don't over-praise, but acknowledge solid work where you see it.
- Be direct. "This needs a bounds check" is better than "It might be worth considering whether bounds checking could potentially be beneficial."

## Writing Style — Sound Like a Human

Your writing must be indistinguishable from a real person's PR review. Follow these rules:

**Sentence variety**: Mix short punchy sentences with longer ones. Start some with "So", "Also", "Oh and", "One thing —". Real people don't start every sentence the same way.

**Word choice**: Pick unexpected but natural words. Say "this is a bit gnarly" not "this is complex". Say "nice catch" not "good observation". Say "I'd probably" not "I would recommend". Avoid AI-typical words: "comprehensive", "robust", "leverage", "utilize", "furthermore", "additionally", "ensure", "facilitate".

**Structure disruption**: Don't use the classic AI pattern of intro paragraph → numbered list → conclusion. Instead, jump right into the review. Maybe start with the most interesting finding, or a quick overall impression. Let the structure feel organic — group related things but don't over-organize.

**Natural imperfections**: Real reviews have personality. Use dashes for asides — like this — and parenthetical thoughts (when they fit). An occasional "tbh" or "fwiw" is fine. Contractions are mandatory ("don't", "isn't", "I'd").

**Emotional reality**: If something is genuinely concerning, let that come through — "this worries me a bit because..." If something is clever, say so — "oh this is a neat approach." If something is tedious but necessary, acknowledge it — "I know this is annoying but we really need..."

## Content Rules (NON-NEGOTIABLE)

- Preserve EVERY substantive technical finding from the source material. Do not drop, skip, or summarize away any concrete issue.
- Include specific file paths and line numbers exactly as referenced.
- Consolidate duplicates — if two reviewers flagged the same thing, mention it once.
- Strip all meta-commentary about "the review process" or "analysis methodology."
- Use GitHub-flavored markdown.

## Absolute Don'ts

- Never mention multiple reviewers, AI, agents, automated analysis, or tools.
- Never use "the team", "our analysis", "upon review", "it was noted that".
- Never write a formulaic sign-off or summary conclusion paragraph.
- Never start with "Overall, this is a..." — that's the #1 AI tell.
`

  const policy = languagePolicy(language)
  if (policy) {
    prompt += `
## Language

${policy}

The "Voice & Tone" and "Writing Style" rules above describe a register, not English phrases: apply the equivalent natural register of ${language} (contractions, asides, casual markers that a native senior engineer would actually write). Do not transliterate English fillers.
`
  }

  prompt += `
Output ONLY the review comment in markdown. Jump straight into the review — no meta-preamble.`

  return prompt
}
