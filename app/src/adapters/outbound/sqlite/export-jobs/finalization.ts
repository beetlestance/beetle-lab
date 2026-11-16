import type {StandaloneExportResult} from '@beetle/contracts';
import type {DatabaseSync} from 'node:sqlite';
import {captureExportResultForExpectation} from '@beetle/contracts';
import type {ExportJob} from '@beetle/contracts/api';
import type {ExportExecutionStore} from '../../../../ports/exports.js';
import type {ExportSources} from './source.js';
import type {ExportReads} from './reads.js';
import {sha256} from '../input-values.js';
import {StorageError} from '../protocol.js';
/** Caller has fenced its transfer producer and awaited result plus settlement. */
export function finalizeExport(db:DatabaseSync,sources:ExportSources,reads:ExportReads,request:Parameters<ExportExecutionStore['finalize']>[0]):ExportJob {
 const binding=sources.binding(request.binding);const key={id:binding.key.exportId,scope:{kind:'workspace' as const,
  organizationId:binding.key.attempt.organizationId,workspaceId:binding.key.attempt.workspaceId}};
 const job=reads.get(key);const source=sources.read(binding);if(!source)return job;
 if(source.sourceDigest!==request.sourceDigest||source.manifest.manifestDigest!==request.manifestDigest)throw new StorageError('conflict');
 if(['ready','failed','cancelled'].includes(job.state))return job;
 sources.stopped(binding,source);const result=captureExportResultForExpectation(source.manifest.result,binding.expectation,sha256);
 const artifact=sources.artifact(binding);
 if(result.status==='succeeded'&&artifact?.phase!=='published')return job;
 const {state,retained}=projection(result,job.cancellationRequested);
 db.prepare('UPDATE export_jobs SET state=?,reason=?,execution_charged=0,output_charged=?,version=version+1 WHERE id=?')
  .run(state,result.reason,retained,job.id);
 return reads.get(key);
}

function projection(result:StandaloneExportResult,cancellation:boolean):{state:ExportJob['state'];retained:number}{
 if(result.status==='succeeded')return {state:'ready',retained:result.artifact.bytes};
 return {state:result.status==='cancelled'&&cancellation?'cancelled':'failed',retained:0};
}
