import type {OutputRuntimeOptions} from '../../ports/output-runtime.js';
/** Capture private metadata capabilities before native namespace acquisition. */
export function captureDeletions(options:OutputRuntimeOptions):Pick<OutputRuntimeOptions,'deletions'|'retirement'|'fileOnlyDeletion'>{
 const m=options.deletions;const r=options.retirement;
 if(!m){if(r||options.fileOnlyDeletion)throw Error('Missing deletion metadata');return {};}
 if(Boolean(options.fileOnlyDeletion)===Boolean(r))throw Error('Explicit deletion mode required');
 const deletions=Object.freeze({reserveControl:m.reserveControl.bind(m),scan:m.scan.bind(m),getFile:m.getFile.bind(m),recordPlan:m.recordPlan.bind(m),recordAbsence:m.recordAbsence.bind(m)});
 if(!r)return {deletions,fileOnlyDeletion:true};
 const rm=r.metadata;
 return {deletions,retirement:Object.freeze({gateway:Object.freeze({retireOutput:r.gateway.retireOutput.bind(r.gateway)}),
  metadata:Object.freeze({scanRetirements:rm.scanRetirements.bind(rm),reserveControl:rm.reserveControl.bind(rm),retirementRequest:rm.retirementRequest.bind(rm),recordCleanupAck:rm.recordCleanupAck.bind(rm)})})};
}
