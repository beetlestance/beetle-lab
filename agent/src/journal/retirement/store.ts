import { readRetirementIntent } from './read.js';
export { readRetirementIntent,retirementIsOpen } from './read.js';
import { retirementIsOpen } from './read.js';
import { fundRejectedIntent,rejectedCandidate } from '../rejected-controls/guard.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { captureOutputRetirementRequest, OUTPUT_RETIREMENT_REQUEST_BYTES } from '@beetle/contracts/output-retirement';
import type { RetirementIntent,RetirementSelection } from '../../retirement-values/index.js';
import { cleanupControl } from '../../cleanup-control/index.js';
import { sourceScope } from '../output-source-input.js';
import { Failure, transaction,owner } from '../sql.js';
import { retirementOperation } from '../retirement-protocol.js';
import type { RetirementOperation, RetirementValue } from '../retirement-protocol.js';
import { eligibleRetirement, retirementKey } from './eligibility.js';
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
function selection(db:DatabaseSync,input:unknown):RetirementSelection{
 const request=captureOutputRetirementRequest(input);const row=owner(db,retirementKey(request));
 return row.cleanup_control_version===1?{funding:'admitted',intent:candidate(db,request)}
  :{funding:'rejected',intent:rejectedCandidate(db,request).intent};
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
      if(captured.kind==='retirementSelection')return selection(this.db,request);
      if(captured.kind==='rejectedCleanupFund')return fundRejectedIntent(this.db,request);
      if(captured.kind==='rejectedCleanupPreflight')return rejectedCandidate(this.db,request).intent;
      return captured.kind === 'retirementBegin' ? write(this.db, request) : candidate(this.db, request);
    });
  }
}
