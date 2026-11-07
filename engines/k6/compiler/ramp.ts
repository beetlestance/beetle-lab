import { limits } from './limits.js';
import type { Checked, ReadonlyScenario } from './types.js';

type DiscoveryScenario = Extract<ReadonlyScenario, { executor: 'ramp-until' }>;

/** Checked again by emission immediately before allocation; extra fields cannot select another path. */
export function checkedRampStageCount(scenario: DiscoveryScenario, path: string): Checked<number> {
  const fail = (code: 'ramp_range' | 'ramp_limit'): Checked<number> => ({ ok: false,
    issues: Object.freeze([Object.freeze({ path, code })]) });
  const rates = [scenario.startRate, scenario.maxRate, scenario.stepRate];
  if (rates.some(rate => !Number.isSafeInteger(rate) || rate < 1 || rate > 1_000_000)) return fail('ramp_range');
  if (scenario.maxRate < scenario.startRate) return fail('ramp_range');
  const count = Math.max(1, Math.ceil((scenario.maxRate - scenario.startRate) / scenario.stepRate));
  if (!Number.isSafeInteger(count) || count > limits.rampStages) return fail('ramp_limit');
  return { ok: true, value: count };
}
