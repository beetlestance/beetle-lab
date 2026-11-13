import { performance } from 'node:perf_hooks';
import type { Operation } from '../backends/docker/index.js';
import { RuntimeRetirementError } from './types.js';
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
/** A private attempt window; issued request promises stay owned after cancellation/expiry. */
export function captureWindow(input: Operation): Operation {
  try {
    const deadline = Object.getOwnPropertyDescriptor(input, 'deadline'); const signal = Object.getOwnPropertyDescriptor(input, 'signal');
    if (!deadline || !('value' in deadline) || typeof deadline.value !== 'number' || !Number.isFinite(deadline.value)) throw new Error();
    if (signal) { if (!('value' in signal)) throw new Error(); Reflect.apply(aborted, signal.value, []); }
    if (deadline.value - performance.now() > 30_000) throw new Error();
    return Object.freeze({ deadline: deadline.value, ...(signal ? { signal: signal.value as AbortSignal } : {}) });
  } catch { throw new RuntimeRetirementError('invalid_input'); }
}
export function checkWindow(operation: Operation, closed: boolean): void {
  if (closed || (operation.signal && Reflect.apply(aborted, operation.signal, []))) throw new RuntimeRetirementError('closed');
  if (performance.now() >= operation.deadline) throw new RuntimeRetirementError('deadline');
}
