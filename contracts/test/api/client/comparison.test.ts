import { expect, it, vi } from 'vitest';
import { createApiClient, runComparisonSnapshotMatches, runComparisonRequestMatches, comparisonWarnings, comparisonFields } from '../../../src/api/index.js';
import type { RunComparisonRequest, RunComparisonSnapshot } from '../../../src/api/index.js';
import { fixture } from '../fixtures.js';
import { baseUrl, reply, params } from './helpers.js';
async function pair(selected = false) {
  const suffix = selected ? '-selected' : '';
  return {request: await fixture(`valid/run-comparison${suffix}-request.json`) as RunComparisonRequest,
    snapshot: await fixture(`valid/run-comparison${suffix}.json`) as RunComparisonSnapshot};
}
it.each([false, true])('uses a scoped POST and accepts ordered evidence (selected=%s)', async selected => {
  const {request, snapshot} = await pair(selected); const fetch = reply(snapshot);
  const result = await createApiClient({baseUrl, fetch}).compareRuns({params, body: request});
  expect(result).toEqual({ok: true, value: snapshot});
  expect(fetch).toHaveBeenCalledTimes(1); const [url, options] = fetch.mock.calls[0]!;
  expect(String(url)).toBe(`https://api.invalid/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/comparisons`);
  expect(options?.method).toBe('POST'); expect(JSON.parse(String(options?.body))).toEqual(request);
});
it('refuses case-folded duplicates, too many runs, foreign route scopes and impossible combined aliases before fetch', async () => {
  const {request} = await pair(true); const fetch = vi.fn<typeof globalThis.fetch>(); const api = createApiClient({baseUrl, fetch});
  const alpha = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  for (const body of [{...request, runIds: [alpha, alpha.toUpperCase()]}, {...request, runIds: [...request.runIds, ...request.runIds, alpha]},
    {...request, scope: {...request.scope, workspaceId: alpha}},
    {...request, metric: {...request.metric!, tags: {request: 'r0', assertion: 'a0'}}}]) {
    expect(await api.compareRuns({params, body})).toMatchObject({ok: false, error: {kind: 'request'}});
  }
  expect(fetch).not.toHaveBeenCalled(); expect(runComparisonRequestMatches({...request, runIds: [alpha, alpha.toUpperCase()]})).toBe(false);
});
type Pair = Awaited<ReturnType<typeof pair>>;
const contradictions: Record<string, (value: Pair) => void> = {
  scope: ({request, snapshot}) => {snapshot.scope.workspaceId = request.runIds[0]!;},
  order: ({snapshot}) => {snapshot.items.reverse();},
  duplicate: ({snapshot}) => {snapshot.items[1] = snapshot.items[0]!;},
  baseline: ({request, snapshot}) => {snapshot.baselineRunId = request.runIds[1]!;},
  active: ({snapshot}) => {snapshot.items[1]!.run.state = 'active';},
  key: ({snapshot}) => {snapshot.metric!.metric = 'other';},
  binding: ({snapshot}) => {snapshot.metricBinding = null;},
  unit: ({snapshot}) => {snapshot.items[0]!.metric.series!.unit = 'count';},
  'total-kind': ({snapshot}) => {snapshot.items[0]!.metric.series!.total = {kind: 'counter', sum: 3};},
  'baseline-alias': ({snapshot}) => {snapshot.items[0]!.metric.series!.tags.request = 'r9';},
  source: ({snapshot}) => {snapshot.items[0]!.metric.manifestDigest = null;},
  summary: ({snapshot}) => {snapshot.items[0]!.result!.requiredAssertions.failed = 1;},
  warnings: ({snapshot}) => {snapshot.items[0]!.warnings = [];},
  differences: ({snapshot}) => {snapshot.items[1]!.differences.fields = [];},
  path: ({snapshot}) => {snapshot.items[1]!.differences.configChanges[0]!.path = '/invalid~escape';},
  'result-source': ({snapshot}) => {
    const item = snapshot.items[0]!; item.result = null; item.run.state = 'errored'; item.run.outcome = 'inconclusive';
    item.warnings = comparisonWarnings(item);
  },
};
it.each(Object.entries(contradictions))('rejects contradictory %s response evidence', async (_mode, mutate) => {
  const value = await pair(true); mutate(value);
  expect(await createApiClient({baseUrl, fetch: reply(value.snapshot)}).compareRuns({params, body: value.request})).toMatchObject({ok: false, error: {kind: 'response'}});
});
it('accepts known missing versus absent logical input and refuses their fabricated zero replacements', async () => {
  const {request, snapshot} = await pair(true); const other = snapshot.items[1]!;
  other.metric = {...other.metric, availability: 'missing', reason: 'not_observed', series: null}; other.warnings = comparisonWarnings(other);
  expect(runComparisonSnapshotMatches(snapshot, request)).toBe(true);
  other.metric = {availability: 'not_applicable', reason: 'logical_input_absent', series: null, manifestDigest: null, measurementSourceTimeMs: null, coverage: null};
  expect(runComparisonSnapshotMatches(snapshot, request)).toBe(true);
  other.metric.series = {ordinal: 0, metric: 'http_req_duration', kind: 'counter', scope: 'execute', tags: {request: 'r1'}, unit: 'count', total: {kind: 'counter', sum: 0}};
  expect(runComparisonSnapshotMatches(snapshot, request)).toBe(false);
});
it('requires explicit unknown/partial/limited warnings and stable declared environment differences', async () => {
  const {request, snapshot} = await pair(); const item = snapshot.items[1]!;
  item.run.state = 'errored'; item.run.outcome = 'inconclusive'; item.result!.outcome = 'inconclusive';
  item.environment.secretVersions = 'unknown'; item.environment.targetDigest = 'f'.repeat(64); item.result!.completeness = 'partial';
  item.differences.limited = true; item.differences.fields = comparisonFields(snapshot.items[0]!, item); item.warnings = comparisonWarnings(item);
  expect(item.differences.fields).toEqual(['target']);
  expect(item.warnings).toEqual(expect.arrayContaining(['unknown_secret_version', 'unknown_contention', 'unknown_target_revision', 'partial_result', 'limited_config_diff']));
  expect(runComparisonSnapshotMatches(snapshot, request)).toBe(true);
});
it('caps the actual comparison body independently of the ordinary API allowance', async () => {
  const {request, snapshot} = await pair(); const json = JSON.stringify(snapshot);
  for (const length of [262144, 262145]) {
    // JSON whitespace preserves a valid schema, so the extra byte must fail transport admission.
    const bytes = json + ' '.repeat(length - new TextEncoder().encode(json).byteLength);
    const client = createApiClient({baseUrl, fetch: async () => new Response(bytes, {headers: {'content-type': 'application/json'}})});
    const result = await client.compareRuns({params, body: request});
    expect(result.ok).toBe(length === 262144);
    if (!result.ok) expect(result.error.kind).toBe('response');
  }
});

it('rejects missing-result/source contradictions in both directions', async () => {
  const {request, snapshot} = await pair(true); const item = snapshot.items[1]!;
  item.metric = {...item.metric, availability: 'unavailable', reason: 'result_absent', series: null, measurementSourceTimeMs: null, coverage: null};
  item.warnings = comparisonWarnings(item); expect(runComparisonSnapshotMatches(snapshot, request)).toBe(false);
  item.result = null; item.run.state = 'errored'; item.run.outcome = 'inconclusive'; item.metric = {...snapshot.items[0]!.metric, availability: 'missing', reason: 'not_observed', series: null};
  item.warnings = comparisonWarnings(item); expect(runComparisonSnapshotMatches(snapshot, request)).toBe(false);
});
