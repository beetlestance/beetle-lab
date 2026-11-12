import type {DatabaseSync} from 'node:sqlite';
import {encodeCanonicalJson,estimateStaging} from '@beetle/contracts';
import type {StandaloneExportAssignment} from '@beetle/contracts';
import type {ExportJob} from '@beetle/contracts/api';
import type {ExportProfilePin} from '../../../../ports/exports.js';
import {nextExecutionOrder} from '../execution-order.js';
import {executionRegistryDigest} from '../execution-intents.js';

/** Caller owns revision, receipt and pin checks in the same immediate transaction. */
export function insertExport(db:DatabaseSync,job:ExportJob,assignment:StandaloneExportAssignment,pin:ExportProfilePin):void {
 const order=nextExecutionOrder(db,'standalone_export',job.activeAttemptId);const offer=assignment.offer;
 const staging=estimateStaging(offer,assignment);const text=encodeCanonicalJson(assignment,2105344);
 db.prepare(`INSERT INTO export_jobs(id,organization_id,workspace_id,suite_id,revision_id,attempt_id,queue_order,
  source_profile,registry_digest,assignment_digest,original_id,intent_digest,input_count,intent_json,
  cpu_millis,memory_bytes,pids,timeout_ms,output_bytes,staging_bytes,mode,maximum_build_bytes,version,state,output_charged)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'queued',0)`).run(job.id,job.scope.organizationId,job.scope.workspaceId,
  job.suiteId,job.revisionId,job.activeAttemptId,order,pin.sourceProfileId,executionRegistryDigest(pin.profile),assignment.assignmentDigest,job.id,offer.intentDigest,offer.inputs.length,
  encodeCanonicalJson(job,32768),offer.budget.cpuMillis,offer.budget.memoryBytes,offer.budget.pids,
  offer.budget.timeoutMs,offer.budget.outputBytes,staging.totalBytes,offer.executionPolicy.mode,assignment.options.maximumBuildBytes);
 db.prepare('INSERT INTO export_originals(export_id,assignment_digest,assignment_json,profile_json) VALUES(?,?,?,?)')
  .run(job.id,assignment.assignmentDigest,text,encodeCanonicalJson(pin.profile,32768));
 for(const input of offer.inputs)db.prepare('INSERT INTO export_input_pins(export_id,organization_id,workspace_id,input_id,sha256,bytes) VALUES(?,?,?,?,?,?)')
  .run(job.id,job.scope.organizationId,job.scope.workspaceId,input.id,input.sha256,input.bytes);
}
