import type {DatabaseSync} from 'node:sqlite';
import type {ExportConfiguration,ExportKey,ExportScan,ExportCandidate,ExportOriginal,ExportControl,ExportExecutionStore} from '../../../../ports/exports.js';
import type {RunConfiguration} from '../../../../ports/runs.js';
import type {ExecutionResourceFact} from '../../../../ports/execution-resources.js';
import type {Settings} from '../settings.js';
import type {ExportReads} from './reads.js';
import {DispatchEligibilityOwner} from '../dispatch-eligibility.js';
import {pendingFacts} from '../dispatch-candidates.js';
import {transaction} from '../transaction.js';
import {original,control} from './originals.js';
import {StorageError} from '../protocol.js';
export class ExportClaims {
 constructor(private readonly db:DatabaseSync,private readonly reads:ExportReads,private readonly settings:Settings,
  private readonly configuration:{runs:RunConfiguration;exports:ExportConfiguration}){}
 original(key:ExportKey):ExportOriginal{return original(this.db,this.reads,key);}
 control(key:ExportKey):ExportControl{return control(this.db,this.reads,key);}
 scan(query:ExportScan):readonly ExportCandidate[]{
  const rows=this.db.prepare(`SELECT id,organization_id,workspace_id,queue_order FROM export_jobs INDEXED BY exports_pending
   WHERE state IN ('queued','dispatching','generating','publishing','unknown') AND queue_order>? ORDER BY queue_order LIMIT ?`)
   .all(query.after??0,query.limit);
  return rows.map(row=>({order:Number(row.queue_order),key:{id:String(row.id),scope:{kind:'workspace',organizationId:String(row.organization_id),workspaceId:String(row.workspace_id)}}}));
 }
 claim(key:ExportKey):Awaited<ReturnType<ExportExecutionStore['claim']>>{
  return transaction(this.db,()=>this.matchedClaim(key));
 }
 private matchedClaim(key:ExportKey):Awaited<ReturnType<ExportExecutionStore['claim']>>{
  const job=this.reads.get(key);const retained=this.control(key);
  if(['ready','failed','cancelled'].includes(job.state))return {kind:'blocked'};
  if(retained.possibleDelivery){if(retained.binding===null)throw new StorageError('unavailable');return {kind:'replay',control:retained};}
  if(retained.cancellationRequested||job.state!=='queued')return {kind:'blocked'};
  const row=this.db.prepare(`SELECT 'standalone_export' AS purpose,queue_order,source_profile AS profile_alias,registry_digest,
   cpu_millis,memory_bytes,pids,timeout_ms,output_bytes,staging_bytes,mode,maximum_build_bytes AS storage_bytes FROM export_jobs WHERE id=?`).get(job.id) as unknown as ExecutionResourceFact;
  const policy=new DispatchEligibilityOwner(this.db,this.settings,this.configuration.runs,this.configuration.exports);
  const decision=policy.evaluateResources(row,policy.barrier(pendingFacts(this.db)));
  if(decision.kind!=='ready'||policy.capacity.runtime===null)return {kind:'blocked'};
  this.db.prepare(`UPDATE export_jobs SET state='dispatching',possible_delivery=1,execution_charged=1,output_charged=maximum_build_bytes,
   journal_authority=?,version=version+1 WHERE id=?`).run(policy.capacity.runtime.journalAuthority,job.id);
  return {kind:'claimed',control:this.control(key)};
 }
}
