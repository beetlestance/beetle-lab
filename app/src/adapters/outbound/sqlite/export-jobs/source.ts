import {decodeArtifact,digest} from '../output-custody/slot.js';
import {natural} from '../output-custody/values.js';
import type {DatabaseSync} from 'node:sqlite';
import type {AttemptSnapshot} from '@beetle/contracts';
import {captureExportResultForExpectation,encodeCanonicalJson,validate} from '@beetle/contracts';
import {verifySourceEnvelope} from '@beetle/contracts/output-source';
import type {Owned,SourceEnvelope} from '@beetle/contracts/output-source';
import type {ExportOutputBinding} from '../../../../domain/output-owner/index.js';
import type {OutputCustodyState,OutputArtifactState} from '../../../../ports/output-custody.js';
import type {ExportReads} from './reads.js';
import {control,matchedBinding} from './originals.js';
import {requireSourceOriginal} from '../source-original.js';
import {checkedRunConfiguration} from '../../execution-profiles/index.js';
import {executionRegistryDigest} from '../execution-intents.js';
import {sha256} from '../input-values.js';
import {StorageError} from '../protocol.js';
const key=(binding:ExportOutputBinding)=>({scope:{kind:'workspace' as const,organizationId:binding.key.attempt.organizationId,
 workspaceId:binding.key.attempt.workspaceId},id:binding.key.exportId});
export class ExportSources {
 constructor(private readonly db:DatabaseSync,private readonly reads:ExportReads){}
 binding(input:ExportOutputBinding):ExportOutputBinding{
  const owner=control(this.db,this.reads,key(input));if(!owner.possibleDelivery||!owner.acknowledged)throw new StorageError('conflict');
  return matchedBinding(owner,input);
 }
 verify(input:unknown,binding:ExportOutputBinding):Owned<SourceEnvelope>{
  const value=verifySourceEnvelope(input,sha256);const job=this.reads.get(key(binding));
  const row=this.db.prepare(`SELECT j.registry_digest,CASE WHEN length(CAST(o.profile_json AS BLOB))<=32768 THEN o.profile_json END profile_json
   FROM export_jobs j JOIN export_originals o ON o.export_id=j.id WHERE j.id=?`).get(job.id);
  if(typeof row?.profile_json!=='string')throw new StorageError('unavailable');
  const profile=checkedRunConfiguration({profiles:[JSON.parse(row.profile_json)],pendingLimit:1}).profiles[0]!;
  if(executionRegistryDigest(profile)!==row.registry_digest||encodeCanonicalJson(profile.engine,4096)!==encodeCanonicalJson(job.engine,4096))throw new StorageError('conflict');
  const engine={id:profile.engine.id,imageDigest:profile.engine.imageDigest,configVersion:profile.engine.configVersion};
  requireSourceOriginal(value,binding,{engine,installedIdentity:profile.installedIdentity});
  captureExportResultForExpectation(value.manifest.result,binding.expectation,sha256);return value;
 }
 read(input:ExportOutputBinding):Owned<SourceEnvelope>|null {
  const binding=this.binding(input);const row=this.db.prepare(`SELECT source_digest,manifest_digest,final_agent_seq,
   CASE WHEN length(CAST(source_json AS BLOB))<=75776 THEN source_json END source_json FROM export_sources WHERE export_id=?`).get(binding.key.exportId);
  if(!row)return null;if(typeof row.source_json!=='string')throw new StorageError('unavailable');
  const value=this.verify(JSON.parse(row.source_json),binding);
  if(value.sourceDigest!==row.source_digest||value.manifest.manifestDigest!==row.manifest_digest||value.closure.finalAgentSeq!==row.final_agent_seq)throw new StorageError('unavailable');
  return value;
 }
 load(input:ExportOutputBinding):OutputCustodyState<ExportOutputBinding>{
  const binding=this.binding(input);const row=this.db.prepare(`SELECT source_digest,manifest_digest,final_agent_seq,json_extract(source_json,'$.manifest.result.status') status,
   json_extract(source_json,'$.manifest.result.artifact') descriptor FROM export_sources WHERE export_id=?`).get(binding.key.exportId);
  if(!row)return {kind:'pending',binding};
  const artifacts=this.artifact(binding);this.matchArtifact(row.status,row.descriptor,artifacts);
  if(typeof row.source_digest!=='string'||typeof row.manifest_digest!=='string'||typeof row.final_agent_seq!=='number')throw new StorageError('unavailable');
  if(!digest(row.source_digest)||!digest(row.manifest_digest))throw new StorageError('unavailable');natural(row.final_agent_seq);if(row.final_agent_seq>65536)throw new StorageError('unavailable');
  return {kind:'adopted',binding,sourceDigest:row.source_digest,manifestDigest:row.manifest_digest,finalAgentSeq:row.final_agent_seq,version:1,artifacts:artifacts?[artifacts]:[]};
 }
 artifact(binding:ExportOutputBinding):OutputArtifactState|null {
  const row=this.db.prepare('SELECT * FROM export_artifacts WHERE export_id=?').get(binding.key.exportId);if(!row)return null;
  return decodeArtifact({ordinal:0,artifactId:row.artifact_id,token:row.token,bytes:row.bytes,sha256:row.sha256,offset:row.offset,
   phase:row.phase,identity:row.identity,writer:row.writer,version:row.version});
 }
 private matchArtifact(status:unknown,descriptor:unknown,artifact:OutputArtifactState|null):void {
  if(status!=='succeeded'){
   if(!['failed','cancelled'].includes(status as string)||artifact!==null||descriptor!==null)throw new StorageError('unavailable');return;
  }
  if(typeof descriptor!=='string'||artifact===null)throw new StorageError('unavailable');
  const expected=JSON.parse(descriptor) as {artifactId:unknown;bytes:unknown;sha256:unknown};
  if(expected.artifactId!==artifact.artifactId||expected.bytes!==artifact.bytes||expected.sha256!==artifact.sha256)throw new StorageError('unavailable');
 }
 stopped(binding:ExportOutputBinding,value:Owned<SourceEnvelope>):void {
  const row=this.db.prepare("SELECT CASE WHEN length(CAST(snapshot_json AS BLOB))<=32768 THEN snapshot_json END snapshot_json FROM export_jobs WHERE id=?").get(binding.key.exportId);
  if(typeof row?.snapshot_json!=='string')throw new StorageError('conflict');
  const snapshot=validate('AttemptSnapshot',JSON.parse(row.snapshot_json));
  if(!snapshot.ok)throw new StorageError('conflict');
  requireReleased(snapshot.value,value.closure.finalAgentSeq);
  if(encodeCanonicalJson(snapshot.value.exportResult,8192)!==encodeCanonicalJson(value.manifest.result,8192))throw new StorageError('conflict');
 }
}

function requireReleased(snapshot:AttemptSnapshot,finalSeq:number):void {
 if(snapshot.state!=='exited'||snapshot.admission?.state!=='released'||snapshot.exportResult===undefined)throw new StorageError('conflict');
 if(snapshot.admission.disposition!=='settled'||snapshot.lastSeq<finalSeq)throw new StorageError('conflict');
}
