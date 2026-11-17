import type { Config } from '../suites/draft.js';
import { isArrival, peakOf } from '../suite-editor/load.js';
import { firstScenario, formatCount, isObj, objects, text } from '../suite-editor/model.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const count = (value: unknown) => (typeof value === 'number' ? formatCount(value) : 'none');

function scenarioChanges(before: Config, after: Config): string[] {
  const a = firstScenario(before);
  const b = firstScenario(after);
  if (!a || !b) return a === b ? [] : ['Scenarios changed'];
  const changes: string[] = [];
  if (a.executor !== b.executor) changes.push(`executor: ${text(a.executor)} to ${text(b.executor)}`);
  const peak = [peakOf(a), peakOf(b)];
  if (peak[0] !== peak[1]) changes.push(`${isArrival(b) ? 'rate' : 'peak'}: ${count(peak[0])} to ${count(peak[1])}`);
  const vus = [a.maxVUs ?? a.vus, b.maxVUs ?? b.vus];
  if (vus[0] !== vus[1]) changes.push(`vus: ${count(vus[0])} to ${count(vus[1])}`);
  return changes;
}

function requestChanges(before: Config, after: Config): string[] {
  const a = new Set(objects(before.requests).map((request) => text(request.id)));
  const b = new Set(objects(after.requests).map((request) => text(request.id)));
  const added = [...b].filter((id) => !a.has(id)).length;
  const removed = [...a].filter((id) => !b.has(id)).length;
  const changes: string[] = [];
  if (added) changes.push(`${added} ${added === 1 ? 'request' : 'requests'} added`);
  if (removed) changes.push(`${removed} ${removed === 1 ? 'request' : 'requests'} removed`);
  if (!added && !removed && !same(before.requests, after.requests)) changes.push('Requests changed');
  return changes;
}

const sections: readonly [string, (config: Config) => unknown][] = [
  ['Thresholds changed', (config) => (isObj(config.loadPlan) ? config.loadPlan.slos : undefined)],
  ['Request mix changed', (config) => config.selections],
  ['Datasets changed', (config) => config.datasets],
  ['Secrets changed', (config) => config.secrets],
  ['Readiness probe changed', (config) => config.readiness],
  ['Target sampling changed', (config) => config.targetSampling],
];

/**
 * Short, client-derived bullets for what changed between two configurations, such as
 * "rate: 1,200 to 1,000" or "Thresholds changed". Derived from the saved configs, not the scripts.
 */
export function configChanges(before: Config, after: Config): string[] {
  const changes: string[] = [];
  if (before.target !== after.target) changes.push(`target: ${text(before.target)} to ${text(after.target)}`);
  changes.push(...scenarioChanges(before, after), ...requestChanges(before, after));
  for (const [label, read] of sections) if (!same(read(before), read(after))) changes.push(label);
  return changes.slice(0, 12);
}
