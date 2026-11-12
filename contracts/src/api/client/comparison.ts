import { encodeJson } from '../../json.js';
import type { RunComparisonRequest, RunComparisonSnapshot, RunComparisonItem } from '../generated/types.js';
import { RUN_COMPARISON_BYTES } from '../limits.js';
import { comparisonFields, comparisonWarnings, comparisonResultMatches } from './comparison-facts.js';
import { comparisonBindingMatches, comparisonKeyText, comparisonMetricMatches } from './comparison-metric.js';
export { comparisonFields, comparisonWarnings } from './comparison-facts.js';
const id = (value: string) => value.toLowerCase();
function setMatches(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every(value => right.includes(value));
}
/** Structural validation precedes canonical-ID and semantic metric request checks. */
export function runComparisonRequestMatches(request: RunComparisonRequest): boolean {
  if (request.runIds.length < 2 || request.runIds.length > 4 || new Set(request.runIds.map(id)).size !== request.runIds.length) return false;
  return !request.metric || request.metric.tags.request === undefined || request.metric.tags.assertion === undefined;
}
function paths(item: RunComparisonItem): boolean {
  const changes = item.differences.configChanges; const identities = new Set<string>();
  for (const change of changes) {
    encodeJson(change.path, 512);
    if (identities.has(change.path) || /~(?![01])/u.test(change.path)) return false;
    identities.add(change.path);
  }
  return changes.length === 0 || item.differences.fields.includes('revision');
}
function itemIdentity(item: RunComparisonItem, request: RunComparisonRequest, index: number): boolean {
  const run = item.run;
  return id(run.id) === id(request.runIds[index]!) && id(run.scope.organizationId) === id(request.scope.organizationId)
    && id(run.scope.workspaceId) === id(request.scope.workspaceId)
    && ['finished', 'cancelled', 'errored'].includes(run.state) && run.outcome !== 'pending';
}
function resultSource(item: RunComparisonItem): boolean {
  if (item.result === null && ['ready', 'missing'].includes(item.metric.availability)) return false;
  return item.result === null || item.metric.reason !== 'result_absent';
}
function itemPresentation(item: RunComparisonItem, baseline: RunComparisonItem, index: number): boolean {
  if (!setMatches(item.differences.fields, comparisonFields(baseline, item)) || !setMatches(item.warnings, comparisonWarnings(item))) return false;
  return index !== 0 || (item.differences.configChanges.length === 0 && !item.differences.limited);
}
function itemMatches(item: RunComparisonItem, baseline: RunComparisonItem, request: RunComparisonRequest, index: number): boolean {
  return itemIdentity(item, request, index) && comparisonResultMatches(item) && paths(item) && resultSource(item)
    && itemPresentation(item, baseline, index) && comparisonMetricMatches(item.metric, request.metric, index === 0);
}
/** Complete response byte/selection/scope/ordered-run/meaning checks; never grants storage authority. */
export function runComparisonSnapshotMatches(snapshot: RunComparisonSnapshot, request: RunComparisonRequest): boolean {
  try {
    encodeJson(snapshot, RUN_COMPARISON_BYTES);
    if (!runComparisonRequestMatches(request) || snapshot.items.length !== request.runIds.length) return false;
    if (id(snapshot.scope.organizationId) !== id(request.scope.organizationId) || id(snapshot.scope.workspaceId) !== id(request.scope.workspaceId)
      || id(snapshot.baselineRunId) !== id(request.runIds[0]!)) return false;
    if (comparisonKeyText(snapshot.metric) !== comparisonKeyText(request.metric) || !comparisonBindingMatches(snapshot.metric, snapshot.metricBinding)) return false;
    return snapshot.items.every((item, index) => itemMatches(item, snapshot.items[0]!, request, index));
  } catch {return false;}
}
