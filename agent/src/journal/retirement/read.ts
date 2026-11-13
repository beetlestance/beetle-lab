import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { Scope } from '../../admission/index.js';
import { captureRetirementIntent } from '../../retirement-values/index.js';
import type { RetirementIntent } from '../../retirement-values/index.js';
import { cleanupControl } from '../../cleanup-control/index.js';
import { Failure } from '../sql.js';
import { retirementKey } from './eligibility.js';
function scoped(db: DatabaseSync, key: Scope) {
  const row = db.prepare('SELECT generation FROM accepted_attempts WHERE attempt_id=? AND organization_id=? AND workspace_id=?')
    .get(key.attemptId, key.organizationId, key.workspaceId);
  if (!row) throw new Failure('not_found'); if (row.generation !== key.generation) throw new Failure('stale_generation'); return row;
}
export function retirementIsOpen(db: DatabaseSync, key: Scope): boolean {
  scoped(db, key); return !db.prepare('SELECT 1 FROM output_retirement_intents WHERE attempt_id=?').get(key.attemptId);
}
/** Metadata observation only; original scope is checked without reading Offer/result bodies. */
export function readRetirementIntent(db: DatabaseSync, key: Scope): RetirementIntent | null {
  scoped(db, key);
  const row = db.prepare(`SELECT
    CASE WHEN length(CAST(request_digest AS BLOB))=64 THEN request_digest END AS request_digest,
    CASE WHEN length(CAST(namespace_identity AS BLOB))=64 THEN namespace_identity END AS namespace_identity,
    CASE WHEN length(CAST(task_namespace_identity AS BLOB))=64 THEN task_namespace_identity END AS task_namespace_identity,
    (typeof(request_digest)='text' AND length(CAST(request_digest AS BLOB))=64 AND typeof(namespace_identity)='text'
      AND length(CAST(namespace_identity AS BLOB))=64 AND (task_namespace_identity IS NULL OR
        (typeof(task_namespace_identity)='text' AND length(CAST(task_namespace_identity AS BLOB))=64))) AS valid,
    CASE WHEN length(CAST(intent_json AS BLOB))<=${cleanupControl.intentBytes} THEN intent_json END AS json
    FROM output_retirement_intents WHERE attempt_id=?`).get(key.attemptId);
  if (!row) return null;
  try {
    if (row.valid !== 1 || typeof row.json !== 'string') throw new Error(); const record = captureRetirementIntent(JSON.parse(row.json) as unknown);
    validateStored(record, row, key);
    return record;
  } catch { throw new Failure('unavailable'); }
}
function validateStored(record: RetirementIntent, row: Record<string, unknown>, key: Scope): void {
  if (encodeCanonicalJson(retirementKey(record.request), 512) !== encodeCanonicalJson(key, 512)) throw new Error();
  if (record.requestDigest !== row.request_digest || record.namespaceIdentity !== row.namespace_identity
    || (record.task.state === 'prepared' ? record.task.taskNamespaceIdentity : null) !== row.task_namespace_identity
    || encodeCanonicalJson(record, cleanupControl.intentBytes) !== row.json) throw new Error();
}
