import type {OutputRuntimeOptions} from '../../ports/output-runtime.js';
/** Bind export capabilities before namespace acquisition yields to native IO. */
export function captureExports(options:OutputRuntimeOptions):Pick<OutputRuntimeOptions,'exports'> {
 const value=options.exports;if(!value)return {};
 const e=value.executions;const o=value.outputs;const gateway=value.gateway;
 return {exports:Object.freeze({
  executions:Object.freeze({scan:e.scan.bind(e),original:e.original.bind(e),control:e.control.bind(e),claim:e.claim.bind(e),observe:e.observe.bind(e),finalize:e.finalize.bind(e)}),
  outputs:Object.freeze({load:o.load.bind(o),readSource:o.readSource.bind(o),adopt:o.adopt.bind(o),claimArtifact:o.claimArtifact.bind(o),
   recordProgress:o.recordProgress.bind(o),beginPublication:o.beginPublication.bind(o),recordPublication:o.recordPublication.bind(o),
   settleAbsence:o.settleAbsence.bind(o),published:o.published.bind(o)}),
  gateway:Object.freeze({exportAttempt:gateway.exportAttempt.bind(gateway),output:gateway.output.bind(gateway)}),
 })};
}
