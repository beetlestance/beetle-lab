import type {OutputRuntimeOptions} from '../../ports/output-runtime.js';
/** Capture private metadata capabilities before native namespace acquisition. */
export function captureDeletions(options:OutputRuntimeOptions):Pick<OutputRuntimeOptions,'deletions'|'retirement'|'settlement'|'fileOnlyDeletion'>{
 const m=options.deletions;const r=options.retirement;
 if(!m){if(r||options.settlement||options.fileOnlyDeletion)throw Error('Missing deletion metadata');return {};}
 if(options.settlement&&!r)throw Error('Settlement requires retirement');
 if(Boolean(options.fileOnlyDeletion)===Boolean(r))throw Error('Explicit deletion mode required');
 const deletions=Object.freeze({reserveControl:m.reserveControl.bind(m),scan:m.scan.bind(m),getFile:m.getFile.bind(m),recordPlan:m.recordPlan.bind(m),recordAbsence:m.recordAbsence.bind(m)});
 if(!r)return {deletions,fileOnlyDeletion:true};
 const rm=r.metadata;
 return {deletions,...captureSettlements(options),retirement:Object.freeze({gateway:Object.freeze({retireOutput:r.gateway.retireOutput.bind(r.gateway)}),
  metadata:Object.freeze({scanRetirements:rm.scanRetirements.bind(rm),reserveControl:rm.reserveControl.bind(rm),retirementRequest:rm.retirementRequest.bind(rm),recordCleanupAck:rm.recordCleanupAck.bind(rm)})})};
}

function captureSettlements(options:OutputRuntimeOptions):Pick<OutputRuntimeOptions,'settlement'>{
 const s=options.settlement;if(!s)return{};const m=s.metadata;
 return{settlement:Object.freeze({gateway:Object.freeze({settleOutput:s.gateway.settleOutput.bind(s.gateway)}),
  store:Object.freeze({settle:s.store.settle.bind(s.store),read:s.store.read.bind(s.store)}),
  metadata:Object.freeze({scanSettlements:m.scanSettlements.bind(m),reserveControl:m.reserveControl.bind(m),retirementRequest:m.retirementRequest.bind(m),cleanupAck:m.cleanupAck.bind(m)})})};
}
