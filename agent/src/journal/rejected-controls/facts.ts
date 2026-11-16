import type { Row } from '../sql.js';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { makeRetirementIntent,retirementDigest } from '../../retirement-values/index.js';
import { rejectedControlValue } from '../../rejected-cleanup-values/index.js';
import { runtimeName } from '../../backends/docker/index.js';
import { readOutputAbsenceAtomic } from '../output-absence.js';
import { readInstalledNamespace } from '../staging-namespace/installed.js';
import { readJournalAuthority } from '../authority.js';
import { Failure,owner,quotaUsed } from '../sql.js';
function requireFact(value:unknown):asserts value{if(!value)throw new Failure('conflict');}
/** Actual rejected closure plus mutually exclusive original records, not generic missing-row inference. */
export function rejectedControlFacts(db:DatabaseSync,input:unknown){
 requireFact(db.isTransaction);const request=captureOutputRetirementRequest(input);requireFact(request.closure.kind==='absence');
 const row=owner(db,request);requireFact(row.execution_purpose==='performance'&&row.intent_digest===request.intentDigest);
 requireFact(request.journalAuthority===readJournalAuthority(db));
 requireUnfundedOriginal(row);
 const proof=readOutputAbsenceAtomic(db,request);requireFact(proof&&proof.admission.state==='rejected');
 requireFact(proof.finalAgentSeq===request.closure.finalAgentSeq&&row.last_seq===proof.finalAgentSeq&&row.acknowledged_seq>=proof.finalAgentSeq);
 requireFact(retirementDigest(encodeCanonicalJson(proof,2048))===request.closure.proofDigest);
 const current=db.prepare(`SELECT CASE WHEN length(CAST(admission_json AS BLOB))<=512 THEN admission_json END json
  FROM output_absence_facts WHERE attempt_id=?`).get(request.attemptId)?.json;
 requireFact(typeof current==='string'&&encodeCanonicalJson(JSON.parse(current) as unknown,512)===encodeCanonicalJson(proof.admission,512));
 absentRecords(db,request.attemptId);
 const installed=readInstalledNamespace(db);requireFact(installed?.state==='bound');
 const name=runtimeName({...request,installationId:installed.intent.root.installationId});
 const control=rejectedControlValue({request,namespaceIdentity:installed.anchor.namespaceIdentity,taskName:name});
 const intent=makeRetirementIntent({request,namespaceIdentity:control.namespaceIdentity,task:{state:'none'}});
 return{request,control,intent,usedBytes:quotaUsed(row),quotaBytes:row.quota_bytes};
}
function absentRecords(db:DatabaseSync,attemptId:string):void{
 for(const table of ['reservations','disk_holds','task_staging_namespaces','runtime_cleanup_associations','output_collection_intents','output_sources','output_delivery_closures']){
  requireFact(!db.prepare(`SELECT 1 FROM ${table} WHERE attempt_id=? LIMIT 1`).get(attemptId));
 }
 requireFact(!db.prepare('SELECT 1 FROM admission_queue WHERE attempt_id=? AND pending=1').get(attemptId));
 requireFact(!db.prepare('SELECT 1 FROM export_assignments WHERE attempt_id=?').get(attemptId));
}

function requireUnfundedOriginal(row:Row):void{
 requireFact(row.cleanup_control_version===0&&row.cleanup_control_bytes===0&&row.staging_namespace_identity===null&&row.hold_bytes===0);
 requireFact(row.collection_bytes===0&&row.source_bytes===0&&row.delivery_bytes===0);
}
