import { expect, it } from 'vitest';
import { runComparisonSnapshotMatches } from '@beetle/contracts/api';
import { fixture, metric, context } from './fixture.js';
it.each([2, 4])('compares %s terminal runs without metric I/O or config values and preserves source meaning', async count => {
  const f = fixture(count); const service = f.service();
  try {
    const snapshot = await service.compare(f.request, context());
    expect(runComparisonSnapshotMatches(snapshot, f.request)).toBe(true); expect(snapshot.items).toHaveLength(count);
    expect(snapshot.items[0]!.result).toMatchObject({outcome: 'passed', requiredAssertions: {required: 1, passed: 1}});
    expect(snapshot.items.every(item => item.metric.availability === 'not_requested')).toBe(true);
    expect(f.lookups).toEqual([]); expect(snapshot.items.every(item => item.differences.configChanges.length === 0)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(f.config(0).target); expect(f.calls).toHaveLength(count * 6);
  } finally {await service.close();}
});
it('maps reordered request aliases through logical IDs before lookup and records changed config paths', async () => {
  const f = fixture(); const config = f.config(1);
  config.requests = [{...structuredClone(config.requests[0]!), id: 'other', name: 'other', assertions: []}, ...config.requests]; f.repin(1);
  const request = {...f.request, metric}; const service = f.service();
  try {
    const snapshot = await service.compare(request, context());
    expect(snapshot.metricBinding).toEqual({requestId: 'get', assertionId: null});
    expect(f.lookups.map(q => q.metric.tags.request)).toEqual(['r0', 'r1']);
    expect(snapshot.items.map(item => item.metric.series?.tags.request)).toEqual(['r0', 'r1']);
    expect(snapshot.items[1]!.differences.fields).toEqual(['revision']); expect(snapshot.items[1]!.differences.configChanges.length).toBeGreaterThan(0);
  } finally {await service.close();}
});
it('keeps assertion identity attached to its request when both request and assertion order change', async () => {
  const f = fixture(); const config = f.config(1);
  config.requests[0]!.assertions.unshift({id: 'optional', kind: 'statusEq', value: 200, required: false});
  config.requests.unshift({...structuredClone(config.requests[0]!), id: 'other', name: 'other', assertions: []}); f.repin(1);
  const request = {...f.request, metric: {metric: 'beetle_assertions', kind: 'counter' as const, scope: 'execute' as const,
    tags: {phase: 'execute' as const, assertion: 'a0'}}};
  f.options.metrics.lookupRunMetricSeries = async query => {
    f.lookups.push({id: query.id, metric: query.metric}); const run = f.runs.get(query.id)!;
    return {source: {id: run.id, scope: run.scope, attemptId: run.activeAttemptId, generation: 1, manifestDigest: 'a'.repeat(64),
      availability: 'ready', reason: null, windows: 1, totalSeries: 1, measurementSourceTimeMs: 1800000000000,
      coverage: {complete: true, latePoints: 0, markerDelayDroppedBuckets: 0}},
    series: {...query.metric, ordinal: 0, unit: 'count', total: {kind: 'counter', sum: 2}}};
  };
  const service = f.service();
  try {
    const snapshot = await service.compare(request, context());
    expect(snapshot.metricBinding).toEqual({requestId: 'get', assertionId: 'status'});
    expect(f.lookups.map(q => q.metric.tags.assertion)).toEqual(['a0', 'a1']);
  } finally {await service.close();}
});
it('marks removed logical inputs as not applicable without reading a different request', async () => {
  const f = fixture(); f.config(1).requests[0]!.id = 'other'; f.repin(1); const service = f.service();
  try {
    const snapshot = await service.compare({...f.request, metric}, context());
    expect(snapshot.items[1]!.metric).toMatchObject({availability: 'not_applicable', reason: 'logical_input_absent', series: null});
    expect(f.lookups).toHaveLength(1);
  } finally {await service.close();}
});
it('exposes explicit environment differences and unknown secret versions without leaking values', async () => {
  const f = fixture(); const canary = 'SYNTHETIC_SECRET_VALUE_NEVER_RETURN';
  f.config(1).target = 'http://changed.invalid/private'; f.config(1).requests[0]!.headers.Authorization = canary;
  f.config(1).secrets = [{name: 'TOKEN', provider: 'mounted', locator: canary}]; f.repin(1); const service = f.service();
  try {
    const snapshot = await service.compare(f.request, context()); const item = snapshot.items[1]!;
    expect(item.differences.fields).toEqual(expect.arrayContaining(['revision', 'target', 'secret_bindings']));
    expect(item.warnings).toContain('unknown_secret_version'); expect(item.warnings).toContain('unknown_contention');
    expect(JSON.stringify(snapshot)).not.toContain(canary); expect(JSON.stringify(snapshot)).not.toContain('changed.invalid');
    expect(item.differences.configChanges.some(change => change.path.includes('Authorization'))).toBe(true);
  } finally {await service.close();}
});

it('compares large identical pinned configurations without inventing a limited change', async () => {
  const f = fixture(); const headers = Object.fromEntries(Array.from({length: 64}, (_, i) => [`X-Header-${i}`, 'SYNTHETIC_CANARY' + 'x'.repeat(3900)]));
  for (let i = 0; i < 2; i++) {
    f.config(i).requests[0]!.headers = {...headers};
    const revision = f.revisions.get([...f.runs.values()][i]!.revisionId)!;
    revision.config.datasets = [{id: 'wide', kind: 'inline', selection: 'byVu', rows: Array.from({length: 4096}, () => ({value: 'x'}))}];
    f.repin(i);
  }
  const service = f.service();
  try {
    const snapshot = await service.compare(f.request, context());
    expect(snapshot.items[1]!.differences).toEqual({fields: [], configChanges: [], limited: false});
    expect(JSON.stringify(snapshot)).not.toContain('SYNTHETIC_CANARY');
  } finally {await service.close();}
});

it('fingerprints inline dataset changes as inputs without returning their values', async () => {
  const f = fixture(); const revision = f.revisions.get([...f.runs.values()][1]!.revisionId)!;
  revision.config.datasets = [{id: 'inline', kind: 'inline', selection: 'byVu', rows: [{value: 'SYNTHETIC_INLINE_CANARY'}]}]; f.repin(1);
  const service = f.service();
  try {
    const snapshot = await service.compare(f.request, context());
    expect(snapshot.items[1]!.differences.fields).toEqual(expect.arrayContaining(['revision', 'inputs']));
    expect(JSON.stringify(snapshot)).not.toContain('SYNTHETIC_INLINE_CANARY');
  } finally {await service.close();}
});
