import { Execution } from './operation.js';
import { snapshot } from './profile.js';
import { productionPorts } from './ports.js';
import type { ExecutionOperation, ExecutionOptions, ExecutionReceipt } from './types.js';
export { ExecutionError } from './types.js';
export type { ExecutionOptions, ExecutionLimits, ExecutionClock, MeasurementReceipt, CollectionReceipt, ExecutionCode,
  MetricFailure, ExecutionEvidence, ExecutionReceipt, ExecutionOperation } from './types.js';

/** One admitted invocation. Default native adapter remains Linux-only; no process-mode installation. */
export function runCompiledK6(input: ExecutionOptions): ExecutionOperation {
  try {
    const execution = new Execution(snapshot(input), productionPorts);
    return Object.freeze({ result: execution.result, final: execution.final, quiesced: execution.quiesced, close: () => execution.close() });
  }
  catch {
    const quiet = Promise.resolve();
    const receipt: ExecutionReceipt = Object.freeze({ ok: false, code: 'profile', build: null, process: null,
      terminalObservedAt: null, summary: null, metrics: null, stream: null, metricFailure: null });
    const result = Promise.resolve(receipt);
    return Object.freeze({ result, final: result, quiesced: quiet, close: () => quiet });
  }
}
