import type {DatabaseSync} from 'node:sqlite';
import type {AttemptSnapshot} from '@beetle/contracts';
import {encodeCanonicalJson,validate} from '@beetle/contracts';
import {captureOutputAbsence} from '@beetle/contracts/output-source';
import type {ExportArtifacts} from '../../../../ports/exports.js';
import type {ExportReads} from './reads.js';
import type {ExportSources} from './source.js';
import {sha256} from '../input-values.js';
import {StorageError} from '../protocol.js';
/** Producer proof settles backend execution custody; it does not retire agent data. */
export function settleExportAbsence(db:DatabaseSync,sources:ExportSources,reads:ExportReads,request:Parameters<ExportArtifacts['settleAbsence']>[0]){
 const binding=sources.binding(request.binding);const proof=captureOutputAbsence(request.proof,{...binding.key.attempt,journalAuthority:binding.journalAuthority});
 const key={id:binding.key.exportId,scope:{kind:'workspace' as const,organizationId:proof.organizationId,workspaceId:proof.workspaceId}};
 const job=reads.get(key);const canonical=encodeCanonicalJson(proof,2048);const digest=sha256(canonical);
 const prior=db.prepare('SELECT proof_digest FROM export_absences WHERE export_id=?').get(job.id);
 if(prior){if(prior.proof_digest!==digest)throw new StorageError('conflict');return job;}
 if(['ready','failed','cancelled'].includes(job.state))throw new StorageError('conflict');
 requireAbsentSnapshot(db,job.id,proof);
 db.prepare('INSERT INTO export_absences(export_id,proof_digest,proof_json) VALUES(?,?,?)').run(job.id,digest,canonical);
 const cancelled=job.cancellationRequested&&proof.reason==='cancelled';
 db.prepare('UPDATE export_jobs SET state=?,reason=?,execution_charged=0,output_charged=0,version=version+1 WHERE id=?')
  .run(cancelled?'cancelled':'failed',proof.reason,job.id);
 return reads.get(key);
}

function requireAbsentSnapshot(db:DatabaseSync,id:string,proof:ReturnType<typeof captureOutputAbsence>):void {
 const snapshot=readSnapshot(db,id);
 if(snapshot.lastSeq!==proof.finalAgentSeq||snapshot.result!==undefined||snapshot.exportResult!==undefined
  ||encodeCanonicalJson(snapshot.admission,2048)!==encodeCanonicalJson(proof.admission,2048))throw new StorageError('conflict');
 if(proof.admission.state!=='rejected'&&snapshot.state!=='exited')throw new StorageError('conflict');
}

function readSnapshot(db:DatabaseSync,id:string):AttemptSnapshot {
 const row=db.prepare('SELECT snapshot_json FROM export_jobs WHERE id=?').get(id);
 if(typeof row?.snapshot_json!=='string')throw new StorageError('conflict');
 const snapshot=validate('AttemptSnapshot',JSON.parse(row.snapshot_json));if(!snapshot.ok)throw new StorageError('unavailable');return snapshot.value;
}
