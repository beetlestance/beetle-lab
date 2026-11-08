import { performance } from 'node:perf_hooks';
import { OUTPUT_COLLECTION_MAX_MS } from '../collection/output/index.js';
import { ControllerError } from './types.js';
import type { ControllerBudget } from './types.js';
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
function field(input: ControllerBudget, name: keyof ControllerBudget): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, name);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new Error();
  return descriptor.value;
}
export function budgetCopy(input: ControllerBudget): Readonly<ControllerBudget> {
  try {
    const value = field(input, 'deadline'); const cancellation = field(input, 'signal');
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error();
    if (cancellation !== undefined && !(cancellation instanceof AbortSignal)) throw new Error();
    const now = performance.now();
    if (value <= now || value - now > OUTPUT_COLLECTION_MAX_MS) throw new Error();
    return Object.freeze({ deadline: value, ...(cancellation === undefined ? {} : { signal: cancellation }) });
  } catch { throw new ControllerError('invalid_input'); }
}
export function checkBudget(budget: ControllerBudget): void {
  if (budget.signal && Reflect.apply(aborted, budget.signal, [])) throw new ControllerError('cancelled');
  if (performance.now() >= budget.deadline) throw new ControllerError('deadline');
}
