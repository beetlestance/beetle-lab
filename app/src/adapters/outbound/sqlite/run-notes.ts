import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { SetRunNoteCommand } from '../../../ports/runs.js';
import { normalizedRunNote } from '../../../application/runs/index.js';
import { nextVersion, requireRule } from '../../../domain/namespaces/index.js';
import { readRunNote } from './run-annotations.js';
import type { RunReads } from './run-reads.js';

/**
 * Runs inside Store's receipt transaction. The note has its own version, so lifecycle
 * transitions never conflict with an edit and an edit never changes Run.version.
 * Postings follow in the same transaction through the run_notes triggers.
 */
export class RunNotes {
  constructor(
    private readonly db: DatabaseSync,
    private readonly reads: RunReads,
  ) {}
  set(command: SetRunNoteCommand): Run {
    const key = { scope: command.request.scope, id: command.id };
    const run = this.reads.get(key);
    const current = readRunNote(this.db, run);
    requireRule(current.noteVersion === command.request.expectedNoteVersion, 'conflict');
    const note = normalizedRunNote(command.request.note);
    if (current.noteVersion === 0)
      this.db
        .prepare('INSERT INTO run_notes(run_id,organization_id,workspace_id,version,note) VALUES(?,?,?,1,?)')
        .run(run.id, run.scope.organizationId, run.scope.workspaceId, note);
    else
      this.db
        .prepare('UPDATE run_notes SET note=?,version=? WHERE run_id=? AND version=?')
        .run(note, nextVersion(current.noteVersion), run.id, current.noteVersion);
    return this.reads.get(key);
  }
}
