import type {CapacityIncrease} from '@beetle/contracts/installation-generation';
import {requireInput} from '../src/capture.js';
export const capacityFlags = ['--memory-mib','--output-pool-mib'] as const;
/** Both maintenance adapters share one bounded capacity flag/amount decoder. */
export function capacityTarget(flag: unknown, value: unknown): CapacityIncrease {
  requireInput(flag === '--memory-mib' || flag === '--output-pool-mib');
  requireInput(typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value));
  const bytes = Number(value) * 1048576;
  requireInput(Number.isSafeInteger(bytes));
  return {resource:flag === '--memory-mib' ? 'memory' : 'outputPool',bytes};
}
