import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { captureOutputRetirementRequest, OUTPUT_RETIREMENT_REQUEST_BYTES } from '@beetle/contracts/output-retirement';
import type { Scope } from '../../admission/index.js';
import { captureRetirementIntent } from '../../retirement-values/index.js';
import type { RetirementIntent } from '../../retirement-values/index.js';
import { cleanupControl } from '../../cleanup-control/index.js';
import { sourceScope } from '../output-source-input.js';
import { Failure, transaction } from '../sql.js';
import { retirementOperation } from '../retirement-protocol.js';
import type { RetirementOperation, RetirementValue } from '../retirement-protocol.js';
import { eligibleRetirement, retirementKey } from './eligibility.js';
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
function candidate(db: DatabaseSync, input: unknown): RetirementIntent {
  let request: RetirementRequest;
  try { request = captureOutputRetirementRequest(input); } catch { throw new Failure('invalid_input'); }
  const prior = readRetirementIntent(db, retirementKey(request));
  const record = eligibleRetirement(db, request);
  if (prior && encodeCanonicalJson(prior, cleanupControl.intentBytes) !== encodeCanonicalJson(record, cleanupControl.intentBytes)) throw new Failure('conflict');
  return prior ?? record;
}
function write(db: DatabaseSync, input: unknown): RetirementIntent {
  const record = candidate(db, input); const key = retirementKey(record.request);
  if (readRetirementIntent(db, key)) return record;
  db.prepare('INSERT INTO output_retirement_intents(attempt_id,request_digest,namespace_identity,task_namespace_identity,intent_json) VALUES(?,?,?,?,?)')
    .run(key.attemptId, record.requestDigest, record.namespaceIdentity,
      record.task.state === 'prepared' ? record.task.taskNamespaceIdentity : null, encodeCanonicalJson(record, cleanupControl.intentBytes));
  return record;
}
function captureCommand(copy: RetirementOperation & { id: number }): RetirementOperation {
  const keyed = copy.kind === 'retirementOpen' || copy.kind === 'retirementRead';
  const expected = keyed ? 'id,key,kind' : 'id,json,kind';
  if (Object.keys(copy).sort().join(',') !== expected) throw new Error();
  if ('key' in copy) return { kind: copy.kind, key: sourceScope(copy.key) };
  if (typeof copy.json !== 'string' || copy.json.length > OUTPUT_RETIREMENT_REQUEST_BYTES
    || Buffer.byteLength(copy.json) > OUTPUT_RETIREMENT_REQUEST_BYTES) throw new Error();
  return { kind: copy.kind, json: encodeJson(captureOutputRetirementRequest(JSON.parse(copy.json) as unknown), OUTPUT_RETIREMENT_REQUEST_BYTES) };
}
export class RetirementStore {
  constructor(private readonly db: DatabaseSync) {}
  execute(command: RetirementOperation & { id: number }): RetirementValue {
    let captured: RetirementOperation;
    try {
      const copy = JSON.parse(encodeJson(command, 4096)) as RetirementOperation & { id: number };
      if (!retirementOperation(copy) || !Number.isSafeInteger(copy.id) || copy.id <= 0) throw new Error();
      captured = captureCommand(copy);
    } catch { throw new Failure('invalid_input'); }
    return transaction(this.db, () => {
      if ('key' in captured) return captured.kind === 'retirementOpen' ? { key: captured.key, open: retirementIsOpen(this.db, captured.key) }
        : { key: captured.key, intent: readRetirementIntent(this.db, captured.key) };
      const request: unknown = JSON.parse(captured.json);
      return captured.kind === 'retirementBegin' ? write(this.db, request) : candidate(this.db, request);
    });
  }
}
