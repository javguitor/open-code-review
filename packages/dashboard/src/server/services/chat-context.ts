/**
 * Chat context builder.
 *
 * Reads on-disk OCR session artifacts and formats them as context
 * for Claude chat conversations. Supports both map runs and review rounds.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getOutputLanguage, languagePolicy } from '@open-code-review/config/language-config'

/** A finding of the round under discussion (id as the dashboard knows it). */
/** `key` (S1, S2…) is set for synthesized findings, whose ids are not reviewer-finding ids. */
export type ChatContextFinding = { id: number; title: string; key?: string }

export type ChatTarget =
  | { type: 'map_run'; sessionId: string; runNumber: number }
  | { type: 'review_round'; sessionId: string; roundNumber: number }

/**
 * Build a formatted context string from on-disk OCR artifacts.
 *
 * For map runs, reads the map.md file.
 * For review rounds, reads final.md and all reviewer markdown files.
 * When `codeRoot` is given, states where the code under review lives.
 */
export function buildChatContext(
  ocrDir: string,
  target: ChatTarget,
  codeRoot?: string,
  findings: ChatContextFinding[] = [],
): string {
  const sessionsDir = join(ocrDir, 'sessions')

  const context =
    target.type === 'map_run'
      ? buildMapRunContext(sessionsDir, target.sessionId, target.runNumber)
      : buildReviewRoundContext(sessionsDir, target.sessionId, target.roundNumber)

  const withProposals =
    target.type === 'review_round' && findings.length > 0
      ? `${context}\n\n${proposalInstructions(findings)}`
      : context

  const withRoot = codeRoot
    ? `${withProposals}\n\nThe code under review is at ${codeRoot} (your working directory); read files from there.`
    : withProposals
  const policy = languagePolicy(getOutputLanguage(ocrDir))
  return policy ? `${withRoot}\n\n${policy}` : withRoot
}

function buildMapRunContext(
  sessionsDir: string,
  sessionId: string,
  runNumber: number
): string {
  const mapPath = join(
    sessionsDir,
    sessionId,
    'map',
    'runs',
    `run-${runNumber}`,
    'map.md'
  )

  const parts: string[] = [
    `You are an expert code reviewer assisting with a code review session.`,
    `You are looking at map run #${runNumber} for session "${sessionId}".`,
    '',
    `Below is the Code Review Map that organizes the changeset into reviewable sections:`,
  ]

  if (existsSync(mapPath)) {
    const content = readFileSync(mapPath, 'utf-8')
    parts.push('')
    parts.push('<map>')
    parts.push(content)
    parts.push('</map>')
  } else {
    parts.push('')
    parts.push('(Map file not found on disk.)')
  }

  return parts.join('\n')
}

function buildReviewRoundContext(
  sessionsDir: string,
  sessionId: string,
  roundNumber: number
): string {
  const roundDir = join(sessionsDir, sessionId, 'rounds', `round-${roundNumber}`)
  const finalPath = join(roundDir, 'final.md')
  const reviewersDir = join(roundDir, 'reviews')

  const parts: string[] = [
    `You are an expert code reviewer assisting with a code review session.`,
    `You are looking at review round #${roundNumber} for session "${sessionId}".`,
    '',
    `Below are the review artifacts for this round:`,
  ]

  // Final synthesis
  if (existsSync(finalPath)) {
    const content = readFileSync(finalPath, 'utf-8')
    parts.push('')
    parts.push('<final-synthesis>')
    parts.push(content)
    parts.push('</final-synthesis>')
  }

  // Individual reviewer outputs
  if (existsSync(reviewersDir)) {
    const files = readdirSync(reviewersDir)
      .filter((f) => f.endsWith('.md'))
      .sort()

    for (const file of files) {
      const content = readFileSync(join(reviewersDir, file), 'utf-8')
      const reviewerName = file.replace(/\.md$/, '')
      parts.push('')
      parts.push(`<reviewer name="${reviewerName}">`)
      parts.push(content)
      parts.push('</reviewer>')
    }
  }

  if (!existsSync(finalPath) && !existsSync(reviewersDir)) {
    parts.push('')
    parts.push('(No review artifacts found on disk for this round.)')
  }

  return parts.join('\n')
}

/** Tells the model how to propose a change to a finding; the user, not the model, applies it. */
function proposalInstructions(findings: ChatContextFinding[]): string {
  const synthesized = findings.some((f) => f.key !== undefined)
  const list = findings.map((f) => {
    const title = f.title.replace(/\s+/g, ' ').trim()
    return f.key === undefined ? `- ${f.id}: ${title}` : `- ${f.id} (${f.key}): ${title}`
  })
  return [
    '<finding-proposals>',
    'You may propose a change to a finding of THIS round (never of another round) when the user',
    'asks about it and you conclude it should change. Emit exactly one fenced block per proposal:',
    '',
    '```ocr-proposal',
    '{"finding_id": <id>, "severity"?: "critical|high|medium|low|info", "category"?: "blocker|should_fix|suggestion|style", "status"?: "confirmed|dismissed|fixed|wont_fix", "reason": "<why, at least 20 characters>"}',
    '```',
    '',
    'Include at least one of severity, category or status. The user decides whether to apply it;',
    synthesized
      ? 'you cannot change findings yourself. This round triages SYNTHESIZED findings (each merges the reviewers\' findings about one problem, as in final.md). Use the numeric id, not the S-key; reviewer findings cannot be proposed on. Synthesized finding ids of this round (key in parentheses):'
      : 'you cannot change findings yourself. Finding ids of this round:',
    ...list,
    '</finding-proposals>',
  ].join('\n')
}
