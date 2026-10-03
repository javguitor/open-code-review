import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from '@open-code-review/persistence'
import { makeTempWorkspace, removeTempWorkspace } from '@open-code-review/persistence/test-support'
import { openDb } from '../../db.js'
import { roundChatSubjects } from '../chat-subjects.js'

let workspace: string
let db: Database

beforeEach(async () => {
  workspace = makeTempWorkspace('chat-subjects-')
  mkdirSync(join(workspace, '.ocr', 'data'), { recursive: true })
  db = await openDb(join(workspace, '.ocr'))
  db.run(
    `INSERT INTO sessions (id, branch, workflow_type, status, current_phase, phase_number, current_round, current_map_run, session_dir)
     VALUES ('s1', 'b', 'review', 'active', 'context', 1, 1, 1, 'd')`,
  )
  db.run("INSERT INTO review_rounds (session_id, round_number) VALUES ('s1', 1)")
  db.run("INSERT INTO reviewer_outputs (round_id, reviewer_type, file_path) VALUES (1, 'r', 'f.md')")
  db.run("INSERT INTO review_findings (reviewer_output_id, title, severity, category) VALUES (1, 'Null deref', 'high', 'blocker')")
})

afterEach(() => removeTempWorkspace(workspace))

const synthesize = () => {
  db.run("INSERT INTO synthesis_findings (round_id, key, title, severity, category) VALUES (1, 'S1', 'Merged', 'high', 'blocker')")
  db.run('INSERT INTO synthesis_finding_sources (synthesis_finding_id, finding_id) VALUES (1, 1)')
}

describe('chat subjects', () => {
  it('a round without synthesized findings addresses reviewer findings', () => {
    expect(roundChatSubjects(db, 1)).toEqual({ kind: 'reviewer', findings: [{ id: 1, title: 'Null deref' }] })
  })

  it('a round with a live synthesized finding addresses only those, whatever the reviewer ids', () => {
    synthesize()
    expect(roundChatSubjects(db, 1)).toEqual({ kind: 'synthesis', findings: [{ id: 1, key: 'S1', title: 'Merged' }] })
  })

  it('a round whose synthesized findings are all retired falls back to reviewer findings', () => {
    synthesize()
    db.run("UPDATE synthesis_findings SET retired_at = datetime('now')")
    expect(roundChatSubjects(db, 1).kind).toBe('reviewer')
  })
})
