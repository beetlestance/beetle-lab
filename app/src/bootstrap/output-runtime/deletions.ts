import type {OutputRuntimeOptions} from '../../ports/output-runtime.js';
/** Capture private metadata capabilities before native namespace acquisition. */
export function captureDeletions(options:OutputRuntimeOptions):Pick<OutputRuntimeOptions,'deletions'>{
 const m=options.deletions;if(!m)return {};
 return {deletions:Object.freeze({scan:m.scan.bind(m),getFile:m.getFile.bind(m),recordPlan:m.recordPlan.bind(m),recordAbsence:m.recordAbsence.bind(m)})};
}
