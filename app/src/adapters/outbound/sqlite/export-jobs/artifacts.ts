import type {DatabaseSync} from 'node:sqlite';
import type {ExportArtifactOperation} from './output-protocol.js';
import type {OutputFileRecord} from '../../../../ports/output-bytes.js';
import type {ExportOutputBinding} from '../../../../domain/output-owner/index.js';
import {transitionArtifact} from '../output-artifacts/index.js';
import {StorageError} from '../protocol.js';
import type {ExportSources} from './source.js';
export function advanceExportArtifact(db:DatabaseSync,sources:ExportSources,operation:ExportArtifactOperation):OutputFileRecord<ExportOutputBinding>{
 const request=operation.request;const key=request.key;const state=sources.load(key.binding);
 if(state.kind!=='adopted'||state.sourceDigest!==key.sourceDigest||state.manifestDigest!==key.manifestDigest||key.ordinal!==0)throw new StorageError('conflict');
 const current=state.artifacts[0];if(!current)throw new StorageError('not_found');
 const next=transitionArtifact(operation,current);
 if(next.version!==current.version)db.prepare('UPDATE export_artifacts SET offset=?,phase=?,identity=?,writer=?,version=? WHERE export_id=?')
  .run(next.offset,next.phase,next.identity,next.writer,next.version,state.binding.key.exportId);
 return {binding:state.binding,artifact:next};
}
