import { fail } from './failure.js';
import { suiteLimits } from './limits.js';
/** Shared across the whole compile, so repeated references cannot amplify materialization unboundedly. */
export interface ExpansionBudget { bytes: number; bodyNodes: number }
export function reserveExpansion(budget: ExpansionBudget, bytes: number): void {
  if (budget.bytes + bytes > suiteLimits.loadedBytes) fail('input_limit');
  budget.bytes += bytes;
}
export function reserveBodyNode(budget: ExpansionBudget): void {
  if (++budget.bodyNodes > suiteLimits.jsonNodes) fail('input_limit');
}
