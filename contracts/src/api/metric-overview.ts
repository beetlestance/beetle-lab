import { encodeJson } from '../json.js';
import type { RunMetricOverview, RunMetricEndpoint, WorkspaceScope } from './generated/types.js';
import { metricValueMatches } from './client/metric-values.js';
type Key = { id: string; attemptId: string; scope: WorkspaceScope };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function traffic(
  value: Pick<RunMetricEndpoint, 'requestCount' | 'requestsPerSecond' | 'failure' | 'latency'>,
  duration: number | null,
) {
  const rate =
    value.requestCount === null || duration === null || duration <= 0 ? null : value.requestCount / (duration / 1000);
  return (
    value.requestsPerSecond === (rate !== null && Number.isFinite(rate) ? rate : null) &&
    (value.failure === null || metricValueMatches(value.failure)) &&
    (value.latency === null || metricValueMatches(value.latency))
  );
}
function contents(value: RunMetricOverview): boolean {
  if (value.availability !== 'ready') return unready(value);
  if (!sourceMatches(value) || !traffic(value, value.testDurationMs)) return false;
  if (!checksMatch(value.checks)) return false;
  if (value.omittedEndpoints > 0 && value.endpoints.length !== 64) return false;
  let previous = -1;
  for (const row of value.endpoints) {
    const index = Number(row.request.slice(1));
    if (index <= previous || !traffic(row, value.testDurationMs)) return false;
    previous = index;
  }
  return aggregateMatches(value);
}
/** Schema validation precedes this scope/source/derived-value and reply-byte binding. */
export function runMetricOverviewMatches(value: RunMetricOverview, key: Key): boolean {
  try {
    encodeJson(value, 131072);
    return (
      same(value.id, key.id) &&
      same(value.attemptId, key.attemptId) &&
      same(value.scope.organizationId, key.scope.organizationId) &&
      same(value.scope.workspaceId, key.scope.workspaceId) &&
      contents(value)
    );
  } catch {
    return false;
  }
}

function additive(total: number | null, parts: readonly (number | null)[], complete: boolean): boolean {
  const known = parts.filter((part): part is number => part !== null);
  if (total === null) return known.length === 0;
  const sum = known.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || sum > total) return false;
  return !complete || known.length !== parts.length || sum === total;
}
function aggregateMatches(value: RunMetricOverview): boolean {
  const rows = value.endpoints;
  const complete = value.omittedEndpoints === 0;
  return (
    additive(
      value.requestCount,
      rows.map((row) => row.requestCount),
      complete,
    ) &&
    additive(
      value.failure?.numerator ?? null,
      rows.map((row) => row.failure?.numerator ?? null),
      complete,
    ) &&
    additive(
      value.failure?.sampleCount ?? null,
      rows.map((row) => row.failure?.sampleCount ?? null),
      complete,
    ) &&
    additive(
      value.latency?.count ?? null,
      rows.map((row) => row.latency?.count ?? null),
      complete,
    )
  );
}

function sourceMatches(value: RunMetricOverview): boolean {
  const source = value.source;
  if (!source) return false;
  if (source.numericVersion === 3 && value.testDurationMs !== null) return false;
  return (
    source.coverage.complete === (source.coverage.latePoints === 0 && source.coverage.markerDelayDroppedBuckets === 0)
  );
}

function unready(value: RunMetricOverview): boolean {
  const missing = [
    value.source,
    value.testDurationMs,
    value.requestCount,
    value.requestsPerSecond,
    value.failure,
    value.latency,
    value.checks,
    value.droppedIterations,
  ];
  return missing.every((field) => field === null) && value.endpoints.length === 0 && value.omittedEndpoints === 0;
}
function checksMatch(check: RunMetricOverview['checks']): boolean {
  return (
    check === null || (check.passed <= check.total && check.ratio === (check.total ? check.passed / check.total : null))
  );
}
