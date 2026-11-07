import type { Checked, ReadonlyLoadPlan, ReadonlyScenario, ScenarioExecution, ValidationIssue } from './types.js';

export const limits = Object.freeze({ durationMs: 86_400_000, graceMs: 3_600_000,
  executionMs: 172_800_000, rampStages: 128, inputBytes: 1_048_576 });
const units: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

function duration(value: string, path: string, issues: ValidationIssue[], zero = false): number {
  const match = /^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/.exec(value);
  const amount = match ? Number(match[1]) * (units[match[2] ?? ''] ?? 0) : NaN;
  if (!Number.isSafeInteger(amount) || amount < (zero ? 0 : 1)) {
    issues.push({ path, code: 'invalid_duration' });
    return 0;
  }
  if (amount > limits.durationMs) issues.push({ path, code: 'duration_limit' });
  return amount;
}

export function rampStageCount(scenario: Extract<ReadonlyScenario, { executor: 'ramp-until' }>): number {
  return Math.max(1, Math.ceil((scenario.maxRate - scenario.startRate) / scenario.stepRate));
}

function activeDuration(scenario: ReadonlyScenario, path: string, issues: ValidationIssue[]): number {
  if ('duration' in scenario) return duration(scenario.duration, path + '/duration', issues);
  if ('maxDuration' in scenario) return duration(scenario.maxDuration, path + '/maxDuration', issues);
  if ('stages' in scenario) return scenario.stages.reduce((sum, stage, index) =>
    sum + duration(stage.duration, `${path}/stages/${index}/duration`, issues), 0);
  const rates = [scenario.startRate, scenario.maxRate, scenario.stepRate];
  if (rates.some(rate => !Number.isSafeInteger(rate) || rate < 1 || rate > 1_000_000)) {
    issues.push({ path, code: 'ramp_range' });
    return 0;
  }
  const count = rampStageCount(scenario);
  if (scenario.maxRate < scenario.startRate) issues.push({ path, code: 'ramp_range' });
  if (count > limits.rampStages) issues.push({ path, code: 'ramp_limit' });
  return count * duration(scenario.stepDuration, path + '/stepDuration', issues);
}

function iterationMetadata(scenario: ReadonlyScenario): ScenarioExecution['iterations'] {
  if (scenario.executor === 'shared-iterations') return { mode: 'shared', total: scenario.iterations };
  if (scenario.executor === 'per-vu-iterations') return {
    mode: 'per-vu', perVu: scenario.iterations, total: scenario.iterations * scenario.vus };
  return undefined;
}

function scenarioTiming(scenario: ReadonlyScenario, index: number, issues: ValidationIssue[]): ScenarioExecution {
  const path = `/scenarios/${index}`;
  const startOffsetMs = duration(scenario.startTime, path + '/startTime', issues, true);
  const gracefulStopMs = duration(scenario.gracefulStop, path + '/gracefulStop', issues, true);
  const gracefulRampDownMs = scenario.executor === 'ramping-vus'
    ? duration(scenario.gracefulRampDown, path + '/gracefulRampDown', issues, true) : 0;
  if (gracefulStopMs > limits.graceMs || gracefulRampDownMs > limits.graceMs) {
    issues.push({ path, code: 'duration_limit' });
  }
  const activeDurationMs = activeDuration(scenario, path, issues);
  if (activeDurationMs > limits.durationMs) issues.push({ path, code: 'duration_limit' });
  if ('timeUnit' in scenario) duration(scenario.timeUnit, path + '/timeUnit', issues);
  if ('maxVUs' in scenario && scenario.maxVUs < scenario.preAllocatedVUs) issues.push({ path, code: 'capacity' });
  const upperBoundMs = startOffsetMs + activeDurationMs + gracefulStopMs + gracefulRampDownMs;
  if (upperBoundMs > limits.executionMs) issues.push({ path, code: 'duration_limit' });
  const result: ScenarioExecution = { id: scenario.id, name: scenario.name, entrypoint: `loadScenario${index}`,
    executor: scenario.executor, startOffsetMs, activeDurationMs, gracefulStopMs, gracefulRampDownMs, upperBoundMs };
  const iterations = iterationMetadata(scenario);
  if (iterations) result.iterations = iterations;
  return result;
}

function identities(plan: ReadonlyLoadPlan, issues: ValidationIssue[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  const rules = new Set<string>();
  plan.scenarios.forEach((scenario, index) => {
    if (ids.has(scenario.id)) issues.push({ path: `/scenarios/${index}/id`, code: 'duplicate_id' });
    if (names.has(scenario.name)) issues.push({ path: `/scenarios/${index}/name`, code: 'duplicate_name' });
    ids.add(scenario.id); names.add(scenario.name);
  });
  const entries = plan.slos.map((rule, index) => ({ rule, path: `/slos/${index}/id` }));
  plan.scenarios.forEach((scenario, index) => {
    if (scenario.executor === 'ramp-until') entries.push({ rule: scenario.stopRule, path: `/scenarios/${index}/stopRule/id` });
  });
  for (const { rule, path } of entries) {
    if (rules.has(rule.id)) issues.push({ path, code: 'duplicate_id' });
    rules.add(rule.id);
  }
}

/** Assumes structural validation; semantic errors contain fixed paths and codes only. */
export function analyzeLoadPlan(plan: ReadonlyLoadPlan): Checked<ScenarioExecution[]> {
  const issues: ValidationIssue[] = [];
  identities(plan, issues);
  const scenarios = plan.scenarios.map((scenario, index) => scenarioTiming(scenario, index, issues));
  if (issues.length) return { ok: false, issues: Object.freeze(issues.slice(0, 16).map(issue => Object.freeze(issue))) };
  return { ok: true, value: scenarios };
}
