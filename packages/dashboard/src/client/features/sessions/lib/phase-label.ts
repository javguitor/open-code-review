import type { MessageKey } from '../../../lib/i18n'

const PHASE_KEYS: Record<string, MessageKey> = {
  context: 'sessions.phase_context',
  'change-context': 'sessions.phase_change_context',
  analysis: 'sessions.phase_analysis',
  reviews: 'sessions.phase_reviews',
  aggregation: 'sessions.phase_aggregation',
  discourse: 'sessions.phase_discourse',
  synthesis: 'sessions.phase_synthesis',
  complete: 'sessions.phase_complete',
  'map-context': 'sessions.phase_map_context',
  topology: 'sessions.phase_topology',
  'flow-analysis': 'sessions.phase_flow_analysis',
  'requirements-mapping': 'sessions.phase_requirements_mapping',
}

/**
 * Display label for a CLI phase name. Known phases are translated; an unknown
 * one falls back to the hyphen-split, capitalized name so a new CLI phase still renders.
 */
export function phaseLabel(name: string, t: (key: MessageKey) => string): string {
  const key = PHASE_KEYS[name]
  if (key) return t(key)
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
