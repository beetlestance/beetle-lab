import type { RequestRow } from './details.js';
import { requestRows, targetOf, thresholds } from './details.js';
import { clock, figure, planSummary, virtualUserLimits } from './plan.js';

type Json = Record<string, unknown>;
/** Peak planned rate or VUs of the first scenario, with its unit. */
function peak(config: Json): string | null {
  const shape = planSummary(config).first;
  if (!shape?.unit || shape.points.length === 0) return null;
  return `${figure(Math.max(...shape.points.map(([, value]) => value)))} ${shape.unit}`;
}
function firstVus(config: Json): ReturnType<typeof virtualUserLimits> {
  const plan = config.loadPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const scenarios = (plan as Json).scenarios;
  if (!Array.isArray(scenarios) || scenarios.length > 64) return null;
  const first: unknown = scenarios[0];
  return first !== null && typeof first === 'object' && !Array.isArray(first) ? virtualUserLimits(first as Json) : null;
}
function changed(label: string, before: string | null, after: string | null): string | null {
  if (before === after) return null;
  if (before === null) return `${label}: set to ${after ?? 'unknown'}`;
  if (after === null) return `${label}: ${before} removed`;
  return `${label}: ${before} to ${after}`;
}
/**
 * Plain-language differences between two saved configurations ("rate: 1,000 a second
 * to 1,200 a second"). Covers what the Overview shows; anything else is "other settings".
 */
function planChanges(before: Json, after: Json): string[] {
  const limitsBefore = firstVus(before);
  const limitsAfter = firstVus(after);
  const value = (n: number | undefined) => (n === undefined ? null : figure(n));
  const planBefore = planSummary(before);
  const planAfter = planSummary(after);
  const length = (ms: number | null) => (ms === null ? null : clock(ms));
  return [
    changed('target', targetOf(before), targetOf(after)),
    changed('executor', planBefore.first?.label ?? null, planAfter.first?.label ?? null),
    changed('peak', peak(before), peak(after)),
    changed('length', length(planBefore.totalMs), length(planAfter.totalMs)),
    changed('preallocated VUs', value(limitsBefore?.allocated), value(limitsAfter?.allocated)),
    changed('maximum VUs', value(limitsBefore?.maximum), value(limitsAfter?.maximum)),
  ].filter((text): text is string => text !== null);
}
function requestChange(old: RequestRow | undefined, row: RequestRow): string | null {
  const name = `${row.method} ${row.path}`;
  if (!old) return `added request ${name}`;
  if (old.method !== row.method || old.path !== row.path) return `request ${old.method} ${old.path} to ${name}`;
  if (old.share !== row.share) return `${name} share: ${old.share ?? 0}% to ${row.share ?? 0}%`;
  return old.checks.join('|') !== row.checks.join('|') ? `${name} checks changed` : null;
}
function requestChanges(before: Json, after: Json): string[] {
  const requests = (config: Json) => new Map(requestRows(config).map((row) => [row.id, row]));
  const oldRequests = requests(before);
  const newRequests = requests(after);
  const bullets = [...newRequests].map(([id, row]) => requestChange(oldRequests.get(id), row));
  for (const [id, row] of oldRequests)
    if (!newRequests.has(id)) bullets.push(`removed request ${row.method} ${row.path}`);
  return bullets.filter((text): text is string => text !== null);
}
function thresholdChanges(before: Json, after: Json): string[] {
  const oldRules = new Set(thresholds(before));
  const newRules = new Set(thresholds(after));
  return [
    ...[...newRules].filter((rule) => !oldRules.has(rule)).map((rule) => `threshold added: ${rule}`),
    ...[...oldRules].filter((rule) => !newRules.has(rule)).map((rule) => `threshold removed: ${rule}`),
  ];
}
export function changeList(before: Json, after: Json): string[] {
  const bullets = [...planChanges(before, after), ...requestChanges(before, after), ...thresholdChanges(before, after)];
  if (bullets.length === 0 && JSON.stringify(before) !== JSON.stringify(after)) bullets.push('other settings changed');
  return bullets.slice(0, 12);
}
