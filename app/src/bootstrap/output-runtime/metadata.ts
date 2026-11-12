import {isExportOutput} from '../../domain/output-owner/index.js';
import type {OutputBinding} from '../../domain/output-owner/index.js';
import type {OutputArtifactStore} from '../../ports/output-artifacts.js';
import type {OutputRuntimeOptions} from '../../ports/output-runtime.js';
/** One transfer owner routes closed output identities to their durable owner. */
export function transferMetadata(options:OutputRuntimeOptions):Pick<OutputArtifactStore<OutputBinding>,
 'load'|'readSource'|'adopt'|'claimArtifact'|'recordProgress'|'beginPublication'|'recordPublication'>{
 const runs=options.outputs;const exports=options.exports?.outputs;
 const exportStore=()=>{if(!exports)throw new Error('Export output capability unavailable');return exports;};
 return {
  load:binding=>isExportOutput(binding)?exportStore().load(binding):runs.load(binding),
  readSource:binding=>isExportOutput(binding)?exportStore().readSource(binding):runs.readSource(binding),
  adopt:request=>isExportOutput(request.binding)?exportStore().adopt({...request,binding:request.binding}):runs.adopt({...request,binding:request.binding}),
  claimArtifact:request=>isExportOutput(request.key.binding)?exportStore().claimArtifact({...request,key:{...request.key,binding:request.key.binding}}):runs.claimArtifact({...request,key:{...request.key,binding:request.key.binding}}),
  recordProgress:request=>isExportOutput(request.key.binding)?exportStore().recordProgress({...request,key:{...request.key,binding:request.key.binding}}):runs.recordProgress({...request,key:{...request.key,binding:request.key.binding}}),
  beginPublication:request=>isExportOutput(request.key.binding)?exportStore().beginPublication({...request,key:{...request.key,binding:request.key.binding}}):runs.beginPublication({...request,key:{...request.key,binding:request.key.binding}}),
  recordPublication:request=>isExportOutput(request.key.binding)?exportStore().recordPublication({...request,key:{...request.key,binding:request.key.binding}}):runs.recordPublication({...request,key:{...request.key,binding:request.key.binding}}),
 };
}
