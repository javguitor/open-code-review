/**
 * Output language from `.ocr/config.yaml` (top-level `language`, a BCP 47
 * tag), parsed with the real YAML parser.
 *
 * `language` controls the prose reviewers write (findings, discourse,
 * synthesis, human-voice rewrite, Ask the Team) and the dashboard interface.
 * Section headings, field labels, verdicts, severities, categories, code,
 * paths and identifiers always stay in English: the CLI and dashboard parse
 * them.
 *
 * `posting.language` is a second, independent tag: the language of the review
 * text posted to GitHub (human review summary, inline comment labels, the
 * "Other comments" heading), read by the PR author. Unset, empty or invalid, it
 * falls back to `language`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export const DEFAULT_OUTPUT_LANGUAGE = "en";

export const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/**
 * Agent-side copy: `packages/agents/skills/ocr/references/language-policy.md`.
 * Keep the two in sync — this one is injected into dashboard-spawned prompts,
 * that one is read by the review workflow.
 */
const LANGUAGE_POLICY_TEMPLATE = `## Output Language

Write all prose in **{language}**: summaries, explanations, issue descriptions, why-it-matters, suggestions, questions, discourse reasoning, synthesis narrative, chat answers. Use the natural register of that language (do not transliterate English fillers such as "tbh"/"fwiw"; use their equivalents or drop them).

Keep the following **exactly as written in English** — tools parse them:
- Section headings: \`## Summary\`, \`## What I Explored\`, \`## Requirements Assessment\`, \`## Findings\`, \`### Finding N: <title>\`, \`## What's Working Well\`, \`## Clarifying Questions\`, \`## Questions for Other Reviewers\`, \`## Verdict\`, \`## Blockers\`, \`## Should Fix\`, \`## Suggestions\`, \`## Consensus & Dissent\`, \`## Individual Reviews\`, \`## Discourse from <reviewer>\`.
- Field labels: \`Severity\`, \`Location\`, \`File\`, \`Lines\`, \`Issue\`, \`Why It Matters\`, \`Suggestion\`, \`Requirements Impact\`, \`Flagged by\`, \`Evidence\`, \`Type\`, \`Date\`, \`Reviewers\`, \`Mode\`.
- Synthesis counts (bold lines): \`**Blockers**: N\`, \`**Should Fix**: N\`, \`**Suggestions**: N\`.
- Map: \`## Section N: <title>\` headings, the table columns \`Done\`, \`File\`, \`Role\`, \`Type\`, \`Description\`, and the bold labels \`**Files**\` and \`**The Story**:\`.
- Vocabularies: verdicts \`APPROVE\` / \`REQUEST CHANGES\` / \`NEEDS DISCUSSION\`; severities \`Critical\` / \`High\` / \`Medium\` / \`Low\` / \`Info\`; categories \`blocker\` / \`should_fix\` / \`suggestion\` / \`style\`; discourse verbs \`AGREE\` / \`CHALLENGE\` / \`CONNECT\` / \`SURFACE\`; status words \`Met\` / \`Partially Met\` / \`Not Met\` / \`Cannot Assess\`.
- Code, file paths, identifiers, commands, JSON keys and values, and quoted error messages.

Finding titles (the text after \`### Finding N:\`) and section bodies are prose and follow {language}.
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the output language from `.ocr/config.yaml`. Never throws: a missing
 * file, missing key, non-string, empty value, invalid tag, or malformed YAML
 * falls back to English. The tag is returned trimmed and lowercased.
 */
export function getOutputLanguage(ocrDir: string): string {
  const configPath = join(ocrDir, "config.yaml");
  if (!existsSync(configPath)) return DEFAULT_OUTPUT_LANGUAGE;

  try {
    const parsed: unknown = parseYaml(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed) || typeof parsed.language !== "string") {
      return DEFAULT_OUTPUT_LANGUAGE;
    }
    const tag = parsed.language.trim();
    return LANGUAGE_TAG.test(tag) ? tag.toLowerCase() : DEFAULT_OUTPUT_LANGUAGE;
  } catch {
    return DEFAULT_OUTPUT_LANGUAGE;
  }
}

/**
 * `posting.language` as configured, or `null` when unset, empty, invalid or
 * the file is unreadable. Never throws. The settings UI uses it to tell
 * "same as language" apart from an explicit choice.
 */
export function getPostingLanguageRaw(ocrDir: string): string | null {
  const configPath = join(ocrDir, "config.yaml");
  if (!existsSync(configPath)) return null;

  try {
    const parsed: unknown = parseYaml(readFileSync(configPath, "utf-8"));
    const posting = isRecord(parsed) ? parsed.posting : undefined;
    if (!isRecord(posting) || typeof posting.language !== "string") return null;
    const tag = posting.language.trim();
    return LANGUAGE_TAG.test(tag) ? tag.toLowerCase() : null;
  } catch {
    return null;
  }
}


/**
 * Language of the review text posted to GitHub: `posting.language` when it is
 * a valid tag, otherwise `getOutputLanguage`. Never throws.
 */
export function getPostingLanguage(ocrDir: string): string {
  return getPostingLanguageRaw(ocrDir) ?? getOutputLanguage(ocrDir);
}

/**
 * The output-language policy to inject into a prompt, or `null` for English
 * (the default needs no instruction) or for a tag that fails `LANGUAGE_TAG`.
 */
export function languagePolicy(language: string): string | null {
  // Invalid tags (e.g. an unsubstituted `{language}`) never reach a prompt.
  if (!LANGUAGE_TAG.test(language)) return null;
  const tag = language.toLowerCase();
  if (tag === "en" || tag.startsWith("en-")) return null;
  return LANGUAGE_POLICY_TEMPLATE.replaceAll("{language}", language);
}
