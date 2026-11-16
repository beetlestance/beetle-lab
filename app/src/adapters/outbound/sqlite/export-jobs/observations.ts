import type {SQLOutputValue,DatabaseSync} from 'node:sqlite';
import {captureExportResultForExpectation,encodeCanonicalJson} from '@beetle/contracts';
import type {AttemptSnapshot} from '@beetle/contracts';
import type {ExportJob} from '@beetle/contracts/api';
import type {ExportExecutionStore} from '../../../../ports/exports.js';
import {mergeAttemptSnapshot} from '../../../../domain/attempt-observation/index.js';
import type {ExportReads} from './reads.js';
import {control} from './originals.js';
import {sha256} from '../input-values.js';
import {transaction} from '../transaction.js';
import {StorageError} from '../protocol.js';
function projection(snapshot:AttemptSnapshot):{state:ExportJob['state'];reason:ExportJob['reason']}{
 if(snapshot.state==='lost')return {state:'unknown',reason:'execution_lost'};
 if(snapshot.state==='exited'||snapshot.admission?.state==='released'||snapshot.admission?.state==='rejected')return {state:'publishing',reason:null};
 if(snapshot.state==='offered'||snapshot.state==='admitted')return {state:'dispatching',reason:null};
 return {state:'generating',reason:null};
}
export class ExportObservations {
 constructor(private readonly db:DatabaseSync,private readonly reads:ExportReads){}
 observe(request:Parameters<ExportExecutionStore['observe']>[0]):ExportJob{
  return transaction(this.db,()=>this.matched(request));
 }
 private matched(request:Parameters<ExportExecutionStore['observe']>[0]):ExportJob{
  const retained=control(this.db,this.reads,request.key);const binding=retained.binding;
  if(binding===null||binding.journalAuthority!==request.journalAuthority||!retained.possibleDelivery)throw new StorageError('conflict');
  const row=this.db.prepare("SELECT snapshot_json IS NOT NULL present,CASE WHEN length(CAST(snapshot_json AS BLOB))<=32768 THEN snapshot_json END snapshot_json FROM export_jobs WHERE id=?").get(retained.key.id);
  const previous=previousSnapshot(row);
  const merged=mergeAttemptSnapshot({expected:binding.key.attempt,previous,incoming:request.snapshot});
  this.requirePurpose(merged,binding.expectation);
  if(['ready','failed','cancelled'].includes(retained.state))return this.reads.get(retained.key);
  const next=projection(merged);const json=encodeCanonicalJson(merged,32768);
  if(row?.snapshot_json===json&&retained.state===next.state)return this.reads.get(retained.key);
  this.db.prepare(`UPDATE export_jobs SET snapshot_json=?,state=?,reason=?,cancellation_requested=MAX(cancellation_requested,?),version=version+1 WHERE id=?`)
   .run(json,next.state,next.reason,Number(merged.cancelRequested),retained.key.id);
  return this.reads.get(retained.key);
 }
 private requirePurpose(snapshot:AttemptSnapshot|null,expectation:Parameters<typeof captureExportResultForExpectation>[1]):void {
  if(snapshot===null)return;
  if(snapshot.result!==undefined)throw new StorageError('invalid_input');
  if(snapshot.exportResult!==undefined)captureExportResultForExpectation(snapshot.exportResult,expectation,sha256);
 }
}

function previousSnapshot(row:Record<string,SQLOutputValue>|undefined):AttemptSnapshot|null {
 if(row?.present===1&&typeof row.snapshot_json!=='string')throw new StorageError('unavailable');
 return typeof row?.snapshot_json==='string'?JSON.parse(row.snapshot_json) as AttemptSnapshot:null;
}
