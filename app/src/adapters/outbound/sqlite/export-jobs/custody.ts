import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {encodeCanonicalJson,captureExportResultForExpectation} from '@beetle/contracts';
import type {ExportOutputBinding} from '../../../../domain/output-owner/index.js';
import type {OutputAdoptRequest,OutputCustodyState} from '../../../../ports/output-custody.js';
import type {ExportSources} from './source.js';
import {sha256} from '../input-values.js';
import {StorageError} from '../protocol.js';
/** Existing metadata transaction owns adoption and its one immutable artifact slot. */
export function adoptExportSource(db:DatabaseSync,sources:ExportSources,request:OutputAdoptRequest<ExportOutputBinding>):OutputCustodyState<ExportOutputBinding>{
 const binding=sources.binding(request.binding);const envelope=sources.verify(request.envelope,binding);sources.stopped(binding,envelope);
 const previous=sources.read(binding);
 if(previous){
  if(encodeCanonicalJson(previous,75776)!==encodeCanonicalJson(envelope,75776))throw new StorageError('conflict');
  return sources.load(binding);
 }
 const result=captureExportResultForExpectation(envelope.manifest.result,binding.expectation,sha256);
 db.prepare('INSERT INTO export_sources(export_id,assignment_digest,manifest_digest,source_digest,source_json,final_agent_seq) VALUES(?,?,?,?,?,?)')
  .run(binding.key.exportId,binding.expectation.assignmentDigest,envelope.manifest.manifestDigest,envelope.sourceDigest,encodeCanonicalJson(envelope,75776),envelope.closure.finalAgentSeq);
 if(result.artifact){const a=result.artifact;
  db.prepare(`INSERT INTO export_artifacts(export_id,artifact_id,token,bytes,sha256,offset,phase,identity,writer,version)
   VALUES(?,?,?,?,?,0,'transferring',NULL,NULL,1)`).run(binding.key.exportId,a.artifactId,randomUUID(),a.bytes,a.sha256);
 }
 return sources.load(binding);
}
