import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { eligibleRetirement,retirementKey } from '../retirement/eligibility.js';
import { readRetirementIntent } from '../retirement/read.js';
import { admissionSnapshot } from '../admission-snapshot.js';
import { reservation } from '../admission-data.js';
import { requireUnstarted } from '../ownership.js';
import { Failure,owner } from '../sql.js';
import { cleanupControl } from '../../cleanup-control/index.js';
function requireFact(value:unknown):asserts value{if(!value)throw new Failure('conflict');}
/** Real C1+retained never-started hold; it cannot borrow rejected funding or invent prepared roles. */
export function eligibleAdmittedNoTask(db:DatabaseSync,request:RetirementRequest){
 const key=retirementKey(request);const row=owner(db,key);const intent=eligibleRetirement(db,request);
 requireFact(request.closure.kind==='absence'&&intent.task.state==='none');
 const stored=readRetirementIntent(db,key);requireFact(stored&&encodeCanonicalJson(stored,4096)===encodeCanonicalJson(intent,4096));
 requireNeverStarted(db,key,row);
 requireFact(row.cleanup_control_bytes===cleanupControl.reservedBytes&&row.hold_bytes===512);
 requireFact(row.source_bytes===0&&row.delivery_bytes===0&&row.collection_bytes===0);
 for(const table of ['task_staging_namespaces','runtime_cleanup_associations','output_sources','output_delivery_closures',
  'output_collection_intents','output_cleanup_plans','output_cleanup_progress','output_cleanup_receipts','rejected_cleanup_controls']){
  requireFact(!db.prepare(`SELECT 1 FROM ${table} WHERE attempt_id=? LIMIT 1`).get(key.attemptId));
 }
 return intent;
}

function requireNeverStarted(db:DatabaseSync,key:ReturnType<typeof retirementKey>,row:ReturnType<typeof owner>):void{
 const admission=admissionSnapshot(db,row);requireFact(admission?.state==='released'&&admission.disposition==='never_started');
 const current=reservation(db,key);requireUnstarted(current);
 requireFact(current.status==='released'&&current.aborted&&current.launchClosed&&current.launchEpoch===0);
 requireFact([current.specDigest,current.startClaimedAt,current.launchSettlement,current.releaseEvidence].every(value=>value===null));
}
