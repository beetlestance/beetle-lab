import { afterEach, expect, it } from 'vitest';
import { validateApi, runMetricOverviewMatches } from '@beetle/contracts/api';
import type { RunMetricsService } from '../../src/ports/run-metrics.js';
import { context, fixture, rewrite } from './fixture.js';
const services: RunMetricsService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.close())); });
const key = (f: Awaited<ReturnType<typeof fixture>>) => ({ id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId });
it('returns pooled percentile evidence, explicit old duration and one endpoint without scanning window data', async () => {
  const f = await fixture(); const service = f.service(); services.push(service);
  const value = await service.reader.getRunMetricOverview(key(f), context());
  expect(validateApi('RunMetricOverview', value).ok).toBe(true); expect(runMetricOverviewMatches(value, key(f))).toBe(true);
  expect(value).toMatchObject({ availability: 'ready', testDurationMs: null, requestCount: null,
    requestsPerSecond: null, checks: null, droppedIterations: null, omittedEndpoints: 0 });
  expect(value.latency?.percentiles.p95).toEqual(value.endpoints[0]?.latency?.percentiles.p95);
  expect(value.latency?.percentiles.p50.source).toBe('histogram-estimate');
  const numeric = f.descriptors.find(a => a.kind === 'numeric-final')!;
  expect(f.reads.filter(r => r.id === numeric.artifactId)).toHaveLength(1);
  expect(f.reads.filter(r => r.id !== numeric.artifactId).every(r => r.end - r.start <= 1024)).toBe(true);
});
it('uses measured duration and native assertion counters, excluding engine counters and retaining real zero', async () => {
  const f = await fixture(); rewrite(f, 'numeric-final', text => {
    const v = JSON.parse(text); v.version = 4; v.timing = { testRunDurationMs: 2000 };
    const counter = (metric: string, sum: number, tags = {}) => ({ metric, kind: 'counter', scope: 'execute', tags, total: { kind: 'counter', sum } });
    v.metrics.totals.push(counter('http_reqs', 8, { phase: 'execute', request: 'r0' }),
      counter('beetle_assertions', 8, { phase: 'execute', assertion: 'a0' }),
      counter('beetle_assertion_failures', 2, { phase: 'execute', assertion: 'a0' }), counter('dropped_iterations', 0),
      { ...counter('beetle_assertions', 100, { phase: 'execute', assertion: 'a1' }), scope: 'engine' });
    return JSON.stringify(v);
  });
  const service = f.service(); services.push(service);
  const value = await service.reader.getRunMetricOverview(key(f), context());
  expect(value).toMatchObject({ requestCount: 8, requestsPerSecond: 4, checks: { passed: 6, total: 8, ratio: 0.75 }, droppedIterations: 0 });
  expect(value.endpoints[0]).toMatchObject({ request: 'r0', requestCount: 8, requestsPerSecond: 4 });
  expect(runMetricOverviewMatches(value, key(f))).toBe(true);
});
it('keeps missing assertion failures unknown rather than assuming no failures', async () => {
  const f = await fixture(); rewrite(f, 'numeric-final', text => {
    const v = JSON.parse(text); v.metrics.totals.push({ metric: 'beetle_assertions', kind: 'counter', scope: 'execute', tags: { phase: 'execute', assertion: 'a0' }, total: { kind: 'counter', sum: 9 } }); return JSON.stringify(v);
  });
  const service = f.service(); services.push(service);
  expect((await service.reader.getRunMetricOverview(key(f), context())).checks).toBeNull();
});
it('bounds endpoint rows while preserving pooled traffic and stating the omission', async () => {
  const f = await fixture(); rewrite(f, 'numeric-final', text => {
    const v = JSON.parse(text); for (let i = 0; i < 70; i++) v.metrics.totals.push({ metric: 'http_reqs', kind: 'counter', scope: 'execute', tags: { phase: 'execute', request: `r${i}` }, total: { kind: 'counter', sum: 1 } });return JSON.stringify(v);
  });
  const service = f.service(); services.push(service); const value = await service.reader.getRunMetricOverview(key(f), context());
  expect(value.endpoints).toHaveLength(64);expect(value.omittedEndpoints).toBe(6);expect(value.requestCount).toBe(70);
  expect(value.endpoints.at(-1)?.request).toBe('r63');expect(runMetricOverviewMatches(value, key(f))).toBe(true);
});
it('does not publish a projection after integrity failure', async () => {
  const f = await fixture(); rewrite(f, 'numeric-final', text => text.replace('"sum":9', '"sum":8'), false);
  const service = f.service();services.push(service);
  await expect(service.reader.getRunMetricOverview(key(f), context())).rejects.toThrow();
});
