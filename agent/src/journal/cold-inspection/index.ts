import type { DatabaseSync } from 'node:sqlite';
import { JOURNAL_SCHEMA_VERSION } from '../schema.js';
import { readJournalAuthority } from '../authority.js';
import { Failure } from '../sql.js';
const pending = [
  'SELECT 1 FROM reservations WHERE charged!=0 LIMIT 1',
  'SELECT 1 FROM admission_queue WHERE pending!=0 LIMIT 1',
  `SELECT 1 FROM accepted_attempts a WHERE a.state!='exited' AND NOT(a.state='offered' AND EXISTS(
    SELECT 1 FROM admission_queue q WHERE q.attempt_id=a.attempt_id AND q.pending=0 AND json_extract(q.decision_json,'$.kind')='reject')) LIMIT 1`,
  'SELECT 1 FROM accepted_attempts WHERE delivery_pending!=0 OR acknowledged_seq!=last_seq LIMIT 1',
  "SELECT 1 FROM installed_staging_namespace WHERE state!='bound' LIMIT 1",
  "SELECT 1 FROM task_staging_namespaces WHERE state!='prepared' LIMIT 1",
];
/** Offline caller retains actual startup exclusion. Unknown/lost/pending work refuses. */
export function inspectColdJournal(db: DatabaseSync, expectedAuthority: string) {
  if (db.prepare('PRAGMA query_only').get()?.query_only !== 1 || db.prepare('PRAGMA user_version').get()?.user_version !== JOURNAL_SCHEMA_VERSION) throw new Failure('recovery_required');
  const authority = readJournalAuthority(db); if (authority !== expectedAuthority) throw new Failure('recovery_required');
  for (const sql of pending) if (db.prepare(sql).get()) throw new Failure('recovery_required');
  return Object.freeze({schema: JOURNAL_SCHEMA_VERSION, journalAuthority: authority});
}

/** Scoped journal identity for an already stopped native runtime, never a release proof. */
export function matchColdRuntime(db: DatabaseSync, input: {attemptId: string; organizationId: string; workspaceId: string; intentDigest: string; imageDigest: string}): void {
  const row = db.prepare(`SELECT a.organization_id,a.workspace_id,a.intent_digest,
    json_extract(a.offer_json,'$.engine.imageDigest') image FROM accepted_attempts a
    JOIN reservations r ON r.attempt_id=a.attempt_id WHERE a.attempt_id=? AND a.state='exited' AND r.charged=0 LIMIT 1`).get(input.attemptId);
  if (!row || row.organization_id !== input.organizationId || row.workspace_id !== input.workspaceId
    || row.intent_digest !== input.intentDigest || row.image !== input.imageDigest) throw new Failure('recovery_required');
}

export { prepareColdJournalCopy } from '../schema.js';
