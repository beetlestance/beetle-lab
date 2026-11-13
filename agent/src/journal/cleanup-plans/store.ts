import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { captureNativeCleanupPlan, nativeCleanupPlanIdentity, captureStoredCleanupPlan, cleanupControl, cleanupPlanFrameBytes } from '../../cleanup-control/index.js';
import type { NativeCleanupPlan, StoredCleanupPlan } from '../../cleanup-control/index.js';
import type { Scope } from '../../admission/index.js';
import { sourceScope } from '../output-source-input.js';
import { readRetirementIntent } from '../retirement/index.js';
import { eligibleRetirement } from '../retirement/eligibility.js';
import { readTaskNamespace } from '../staging-namespace/tasks.js';
import { Failure, transaction } from '../sql.js';
import type { CleanupPlanOperation, CleanupPlanValue } from '../cleanup-plan-protocol.js';
import { cleanupPlanOperation } from '../cleanup-plan-protocol.js';
import { checkedText, matchesPlan } from './validation.js';
export function planKey(plan: NativeCleanupPlan): Scope & {generation:1} {
  const { organizationId, workspaceId, attemptId, generation } = plan.original; return { organizationId, workspaceId, attemptId, generation };
}
function read(db: DatabaseSync, key: Scope): StoredCleanupPlan | null {
  readRetirementIntent(db, key);
  const row = db.prepare(`SELECT CASE WHEN length(CAST(plan_json AS BLOB))<=${cleanupControl.planBytes} THEN plan_json END AS json,
    CASE WHEN length(CAST(plan_identity AS BLOB))=64 THEN plan_identity END AS identity,
    encoded_bytes,charged_bytes FROM output_cleanup_plans WHERE attempt_id=?`).get(key.attemptId);
  if (!row) return null;
  try {
    const json = checkedText(row.json, cleanupControl.planBytes); const result = captureStoredCleanupPlan({planIdentity:row.identity,plan:JSON.parse(json) as unknown});
    if (encodeCanonicalJson(planKey(result.plan), 512) !== encodeCanonicalJson(key, 512)
      || json !== encodeCanonicalJson(result.plan, cleanupControl.planBytes) || row.encoded_bytes !== Buffer.byteLength(json)
      || row.charged_bytes !== Buffer.byteLength(json) + 512) throw new Error(); return result;
  } catch { throw new Failure('unavailable'); }
}
function store(db: DatabaseSync, plan: NativeCleanupPlan): StoredCleanupPlan {
  const key = planKey(plan); const intent = readRetirementIntent(db, key);
  if (!intent) throw new Failure('conflict');
  const eligible = eligibleRetirement(db, intent.request); const task = readTaskNamespace(db, key);
  if (encodeCanonicalJson(eligible, cleanupControl.intentBytes) !== encodeCanonicalJson(intent, cleanupControl.intentBytes)
    || task?.state !== 'prepared' || !matchesPlan(plan, intent, task.anchor)) throw new Failure('conflict');
  const existing = read(db, key); const planIdentity = nativeCleanupPlanIdentity(plan);
  if (existing) { if (existing.planIdentity !== planIdentity) throw new Failure('conflict'); return existing; }
  const json = encodeCanonicalJson(plan, cleanupControl.planBytes); const bytes = Buffer.byteLength(json);
  db.prepare('INSERT INTO output_cleanup_plans(attempt_id,plan_identity,plan_json,encoded_bytes,charged_bytes) VALUES(?,?,?,?,?)')
    .run(key.attemptId, planIdentity, json, bytes, bytes + 512); return { planIdentity, plan };
}
function command(input: CleanupPlanOperation & {id:number}): CleanupPlanOperation {
  const copy = JSON.parse(encodeJson(input, cleanupPlanFrameBytes)) as CleanupPlanOperation & {id:number};
  if (!cleanupPlanOperation(copy) || !Number.isSafeInteger(copy.id) || copy.id <= 0) throw new Error();
  if (copy.kind === 'cleanupPlanRead') {
    if (Object.keys(copy).sort().join(',') !== 'id,key,kind') throw new Error(); return {kind:copy.kind,key:sourceScope(copy.key)};
  }
  if (Object.keys(copy).sort().join(',') !== 'id,json,kind') throw new Error();
  const plan = captureNativeCleanupPlan(JSON.parse(checkedText(copy.json, cleanupControl.planBytes)) as unknown);
  return {kind:copy.kind,json:encodeCanonicalJson(plan,cleanupControl.planBytes)};
}
export class CleanupPlanStore {
  constructor(private readonly db: DatabaseSync) {}
  execute(input: CleanupPlanOperation & {id:number}): CleanupPlanValue {
    let captured: CleanupPlanOperation;try{captured=command(input);}catch{throw new Failure('invalid_input');}
    return transaction(this.db,()=>{
      if(captured.kind==='cleanupPlanRead')return{key:captured.key,stored:read(this.db,captured.key)};
      const plan=captureNativeCleanupPlan(JSON.parse(captured.json) as unknown);return{key:planKey(plan),stored:store(this.db,plan)};
    });
  }
}
