import type { Checked, ReadonlyLoadPlan, ReadonlyScenario, ScenarioExecution, ValidationIssue } from './types.js';

import { limits } from './limits.js';
import { checkedRampStageCount } from './ramp.js';
const units: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

function duration(value: string, path: string, issues: ValidationIssue[], minimum = 1): number {
  const match = /^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/.exec(value);
  const amount = match ? Number(match[1]) * (units[match[2] ?? ''] ?? 0) : NaN;
  if (!Number.isSafeInteger(amount) || amount < minimum) {
    issues.push({ path, code: 'invalid_duration' });
    return 0;
  }
  if (amount > limits.durationMs) issues.push({ path, code: 'duration_limit' });
  return amount;
}

function stageDuration(scenario: Extract<ReadonlyScenario, { stages: unknown }>, path: string, issues: ValidationIssue[]): number {
  return scenario.stages.reduce((sum, stage, index) =>
    sum + duration(stage.duration, `${path}/stages/${index}/duration`, issues), 0);
}

function rampingVuDuration(scenario: Extract<ReadonlyScenario, { executor: 'ramping-vus' }>, path: string, issues: ValidationIssue[]): number {
  if (scenario.startVUs === 0 && scenario.stages.every(stage => stage.target === 0)) {
    issues.push({ path: path + '/stages', code: 'capacity' });
  }
  return stageDuration(scenario, path, issues);
}

function discoveryDuration(scenario: Extract<ReadonlyScenario, { executor: 'ramp-until' }>, path: string, issues: ValidationIssue[]): number {
  const count = checkedRampStageCount(scenario, path);
  if (!count.ok) {
    issues.push(...count.issues);
    return 0;
  }
  return count.value * duration(scenario.stepDuration, path + '/stepDuration', issues);
}

function activeDuration(scenario: ReadonlyScenario, path: string, issues: ValidationIssue[]): number {
  switch (scenario.executor) {
    case 'constant-arrival-rate':
    case 'constant-vus': return duration(scenario.duration, path + '/duration', issues, 1000);
    case 'shared-iterations':
    case 'per-vu-iterations': return duration(scenario.maxDuration, path + '/maxDuration', issues, 1000);
    case 'ramping-arrival-rate': return stageDuration(scenario, path, issues);
    case 'ramping-vus': return rampingVuDuration(scenario, path, issues);
    case 'ramp-until': return discoveryDuration(scenario, path, issues);
  }
}

function iterationMetadata(scenario: ReadonlyScenario, path: string, issues: ValidationIssue[]): ScenarioExecution['iterations'] {
  if (scenario.executor === 'shared-iterations') {
    if (scenario.iterations < scenario.vus) issues.push({ path: path + '/iterations', code: 'capacity' });
    return { mode: 'shared', total: scenario.iterations };
  }
  if (scenario.executor === 'per-vu-iterations') return {
    mode: 'per-vu', perVu: scenario.iterations, total: scenario.iterations * scenario.vus };
  return undefined;
}

function scenarioTiming(scenario: ReadonlyScenario, index: number, issues: ValidationIssue[]): ScenarioExecution {
  const path = `/scenarios/${index}`;
  const startOffsetMs = duration(scenario.startTime, path + '/startTime', issues, 0);
  const gracefulStopMs = duration(scenario.gracefulStop, path + '/gracefulStop', issues, 0);
  const gracefulRampDownMs = scenario.executor === 'ramping-vus'
    ? duration(scenario.gracefulRampDown, path + '/gracefulRampDown', issues, 0) : 0;
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
  const iterations = iterationMetadata(scenario, path, issues);
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
