import {checkedRunConfiguration} from '../../execution-profiles/index.js';
import {executionRegistryDigest} from '../execution-intents.js';
import type {ExportJob} from '@beetle/contracts/api';
import type {StandaloneExportAssignment} from '@beetle/contracts';
import type {DatabaseSync} from 'node:sqlite';
import {captureStandaloneExportAssignment,encodeCanonicalJson,captureExportExpectation} from '@beetle/contracts';
import type {ExportKey,ExportOriginal,ExportControl} from '../../../../ports/exports.js';
import type {ExportOutputBinding} from '../../../../domain/output-owner/index.js';
import {captureOutputBinding} from '../../../../domain/output-owner/index.js';
import type {ExportReads} from './reads.js';
import {StorageError} from '../protocol.js';
import {sha256} from '../input-values.js';
export function original(db:DatabaseSync,reads:ExportReads,key:ExportKey):ExportOriginal {
 const job=reads.get(key);
 const row=db.prepare(`SELECT CASE WHEN length(CAST(o.assignment_json AS BLOB))<=2105344 THEN o.assignment_json END assignment_json,
  o.profile_json,j.registry_digest,j.journal_authority,j.possible_delivery,j.cancellation_requested,j.snapshot_json IS NOT NULL acknowledged FROM export_jobs j JOIN export_originals o ON o.export_id=j.id WHERE j.id=?`).get(job.id);
 if(typeof row?.assignment_json!=='string')throw new StorageError('unavailable');
 if(typeof row.profile_json!=='string')throw new StorageError('unavailable');
 const profile=checkedRunConfiguration({profiles:[JSON.parse(row.profile_json)],pendingLimit:1}).profiles[0]!;
 const assignment=captureStandaloneExportAssignment(JSON.parse(row.assignment_json),sha256);
 if(executionRegistryDigest(profile)!==row.registry_digest||encodeCanonicalJson(profile.engine,4096)!==encodeCanonicalJson(job.engine,4096)
  ||encodeCanonicalJson(profile.installedIdentity,4096)!==encodeCanonicalJson(assignment.offer.installedIdentity,4096))throw new StorageError('unavailable');
 requireJobAssignment(job,assignment);
 return {key:{scope:job.scope,id:job.id},assignment,journalAuthority:typeof row.journal_authority==='string'?row.journal_authority:null,
  possibleDelivery:row.possible_delivery===1,cancellationRequested:row.cancellation_requested===1,acknowledged:row.acknowledged===1};
}
export function matchedBinding(value:ExportControl,input:ExportOutputBinding):ExportOutputBinding {
 const expected=value.binding;if(expected===null)throw new StorageError('conflict');
 if(encodeCanonicalJson(captureOutputBinding(input),4096)!==encodeCanonicalJson(expected,4096))throw new StorageError('conflict');
 return expected;
}
/** Polling reads compact scalars, never the immutable test configuration. */
export function control(db:DatabaseSync,reads:ExportReads,key:ExportKey):ExportControl {
 const job=reads.get(key);
 const row=db.prepare(`SELECT intent_digest,assignment_digest,maximum_build_bytes,journal_authority,possible_delivery,
  snapshot_json IS NOT NULL acknowledged,json_extract(snapshot_json,'$.cancelRequested') cancellation_delivered
  FROM export_jobs WHERE id=?`).get(job.id);
 if(typeof row?.intent_digest!=='string'||typeof row.assignment_digest!=='string'||typeof row.maximum_build_bytes!=='number')throw new StorageError('unavailable');
 let binding:ExportOutputBinding|null=null;
 if(row.journal_authority!==null){
  if(typeof row.journal_authority!=='string')throw new StorageError('unavailable');
  const expectation=captureExportExpectation({exportId:job.id,attemptId:job.activeAttemptId,organizationId:job.scope.organizationId,
   workspaceId:job.scope.workspaceId,assignmentDigest:row.assignment_digest,maximumBuildBytes:row.maximum_build_bytes});
  const captured=captureOutputBinding({purpose:'standalone_export',key:{exportId:job.id,attempt:{attemptId:job.activeAttemptId,
   organizationId:job.scope.organizationId,workspaceId:job.scope.workspaceId,generation:1,intentDigest:row.intent_digest}},
   journalAuthority:row.journal_authority,expectation});
  if(!('purpose'in captured))throw new StorageError('unavailable');binding=captured;
 }
 return {key:{scope:job.scope,id:job.id},binding,state:job.state,possibleDelivery:row.possible_delivery===1,
  acknowledged:row.acknowledged===1,cancellationRequested:job.cancellationRequested,cancellationDelivered:row.cancellation_delivered===1};
}

function requireJobAssignment(job:ExportJob,assignment:StandaloneExportAssignment):void {
 if(assignment.exportId!==job.id||assignment.offer.attemptId!==job.activeAttemptId||assignment.source.revisionId!==job.revisionId
  ||assignment.source.revisionDigest!==job.revisionDigest||assignment.offer.organizationId!==job.scope.organizationId||assignment.offer.workspaceId!==job.scope.workspaceId){
  throw new StorageError('unavailable');
 }
}
