import type {DatabaseSync} from 'node:sqlite';
import {validateApi} from '@beetle/contracts/api';
import type {ExportJob,WorkspaceScope} from '@beetle/contracts/api';
import type {CreateExportCommand,CancelExportCommand,ExportConfiguration} from '../../../../ports/exports.js';
import type {RunConfiguration} from '../../../../ports/runs.js';
import {requireRule} from '../../../../domain/namespaces/index.js';
import {storageFits} from '../../../../domain/settings/index.js';
import type {Suites} from '../suites.js';
import {normalizedScope} from '../suites.js';
import type {Settings} from '../settings.js';
import {checkRevisionPins} from '../revision-pins.js';
import {checkExecutionQueue} from '../execution-queue.js';
import {StorageError} from '../protocol.js';
import {lower} from '../input-values.js';
import {checkedExportConfiguration} from '../../execution-profiles/index.js';
import {makeExportAssignment} from './assignment.js';
import {insertExport} from './insert.js';
import {ExportReads} from './reads.js';
import {EXPORT_METADATA_BYTES} from './schema.js';

export class ExportJobs {
 readonly reads:ExportReads;readonly configuration:ExportConfiguration;
 constructor(private readonly db:DatabaseSync,private readonly suites:Suites,private readonly settings:Settings,
  config:{runs:RunConfiguration;exports:ExportConfiguration}){
  this.configuration=checkedExportConfiguration(config.exports,config.runs);this.reads=new ExportReads(db,suites);
 }
 create(command:CreateExportCommand):ExportJob {
  requireRule(this.db.isTransaction,'conflict');const scope=normalizedScope(command.request.scope);this.suites.workspace(scope);
  const revision=this.suites.getRevision({scope,id:command.request.revisionId});checkRevisionPins(this.db,revision);
  const pin=this.configuration.profiles.find(entry=>entry.sourceProfileId===command.request.engineProfile);requireRule(pin!==undefined,'capacity_unavailable');
  const resolved=this.settings.resolveRun(scope,{engineProfile:command.request.engineProfile,budget:command.request.budget});
  checkExecutionQueue(this.db,this.configuration.pendingLimit);this.reserveMetadata();
  const job:ExportJob={id:lower(command.id),scope,version:1,suiteId:revision.suiteId,revisionId:revision.id,revisionDigest:revision.digest,
   activeAttemptId:lower(command.attemptId),requestedAt:command.requestedAt,state:'queued',cancellationRequested:false,reason:null,
   sourceProfileId:pin.sourceProfileId,engine:pin.profile.engine,budget:resolved.defaults.budget,executionPolicy:command.request.executionPolicy,
   settingsVersions:resolved.versions,options:command.request.options,artifact:null};
  requireRule(validateApi('ExportJob',job).ok);
  const assignment=makeExportAssignment(job,revision,pin,command);insertExport(this.db,job,assignment,pin);return job;
 }
 private reserveMetadata():void {
  const capacity=this.settings.capacity();requireRule(capacity.runtime!==null,'capacity_unavailable');
  const current=this.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;
  if(typeof current!=='number')throw new StorageError('unavailable');
  requireRule(storageFits({chargedBytes:current,requestedBytes:EXPORT_METADATA_BYTES,
   allocationBytes:Math.min(capacity.installation.values.pool.storageBytes,capacity.runtime.ceilings.pool.storageBytes),
   reserveBytes:Math.max(capacity.installation.values.pool.freeSpaceReserveBytes,capacity.runtime.ceilings.pool.freeSpaceReserveBytes)}),'capacity_unavailable');
 }
 cancel(command:CancelExportCommand):ExportJob {
  requireRule(this.db.isTransaction,'conflict');const key={scope:command.request.scope,id:command.id};const job=this.reads.get(key);
  if(['ready','failed','cancelled'].includes(job.state)||job.cancellationRequested)return job;
  const row=this.db.prepare('SELECT possible_delivery FROM export_jobs WHERE id=?').get(job.id);if(!row)throw new StorageError('unavailable');
  const state=row.possible_delivery===0?'cancelled':job.state;const reason=state==='cancelled'?'cancelled':job.reason;
  this.db.prepare('UPDATE export_jobs SET cancellation_requested=1,state=?,reason=?,version=version+1 WHERE id=?').run(state,reason,job.id);
  return this.reads.get(key);
 }
 profiles(scope:WorkspaceScope):readonly string[]{this.suites.workspace(scope);return this.configuration.profiles.map(entry=>entry.sourceProfileId);}
}
