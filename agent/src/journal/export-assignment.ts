import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { captureStandaloneExportAssignment, encodeJson, EXPORT_ASSIGNMENT_BYTES } from '@beetle/contracts';
import type { StandaloneExportAssignment } from '@beetle/contracts';
import { Failure, owner } from './sql.js';
import type { AttemptKey } from './protocol.js';
export function captureExport(input: unknown): StandaloneExportAssignment {
  try {return captureStandaloneExportAssignment(input,text=>createHash('sha256').update(text).digest('hex'));}
  catch {throw new Failure('invalid_input');}
}
export function readExport(db: DatabaseSync, key: AttemptKey): StandaloneExportAssignment | null {
  const parent=owner(db,key);
  const purpose=parent.execution_purpose;
  const row=db.prepare(`SELECT assignment_digest, CASE WHEN length(CAST(assignment_json AS BLOB))<=${EXPORT_ASSIGNMENT_BYTES}
    THEN assignment_json ELSE NULL END AS assignment_json FROM export_assignments WHERE attempt_id=?`).get(key.attemptId);
  if (!row) {if (purpose !== 'performance') throw new Failure('unavailable');return null;}
  if (purpose !== 'standalone_export') throw new Failure('unavailable');
  if (typeof row.assignment_json !== 'string') throw new Failure('unavailable');
  let value: StandaloneExportAssignment;
  try {value=captureExport(JSON.parse(row.assignment_json) as unknown);} catch {throw new Failure('unavailable');}
  if (value.assignmentDigest !== row.assignment_digest || value.offer.attemptId !== key.attemptId
    || value.offer.organizationId !== key.organizationId || value.offer.workspaceId !== key.workspaceId) throw new Failure('unavailable');
  return value;
}
/** The accepted Offer transaction owns creation; a replay can never attach a purpose. */
export function requirePurpose(db: DatabaseSync, key: AttemptKey, expected?: StandaloneExportAssignment): void {
  const value=readExport(db,key);
  if (value?.assignmentDigest !== expected?.assignmentDigest) throw new Failure('conflict');
}
export function insertExport(db: DatabaseSync, assignment?: StandaloneExportAssignment): void {
  if (!assignment) return;
  db.prepare('INSERT INTO export_assignments(attempt_id,assignment_digest,assignment_json) VALUES (?,?,?)')
    .run(assignment.offer.attemptId,assignment.assignmentDigest,encodeJson(assignment,EXPORT_ASSIGNMENT_BYTES));
}
