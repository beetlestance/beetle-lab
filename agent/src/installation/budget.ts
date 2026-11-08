import { performance } from 'node:perf_hooks';
import type { Operation } from '../backends/docker/index.js';
import { InstallationError } from './types.js';
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
export function budgetCopy(input: Operation): Operation {
  try {
    const deadline = Object.getOwnPropertyDescriptor(input, 'deadline');
    const signal = Object.getOwnPropertyDescriptor(input, 'signal');
    if (!deadline || !('value' in deadline) || typeof deadline.value !== 'number'
      || !Number.isFinite(deadline.value)) throw new Error();
    if (signal && (!('value' in signal) || !(signal.value instanceof AbortSignal))) throw new Error();
    const result = Object.freeze({ deadline: deadline.value as number, ...(signal ? { signal: signal.value as AbortSignal } : {}) });
    checkBudget(result); return result;
  } catch { throw new InstallationError('invalid_input'); }
}
export function checkBudget(input: Operation): void {
  if (input.signal && Reflect.apply(aborted, input.signal, [])) throw new InstallationError('closed');
  if (performance.now() >= input.deadline) throw new InstallationError('clock');
}
