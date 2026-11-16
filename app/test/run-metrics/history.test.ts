import { afterEach, expect, it, vi } from 'vitest';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
import type { RunMetricsService } from '../../src/ports/run-metrics.js';
import { context, digest, fixture, rewrite } from './fixture.js';
const services: RunMetricsService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.close())); });
it('projects existing v3 numeric totals with explicit missing native duration and bounded archive edges', async () => {
  const f = await fixture(); const service = f.service(); services.push(service);
  const result = await service.readRunHistorySummary({ id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId }, context());
  expect(result).toMatchObject({ availability: 'ready', source: { numericVersion: 3, manifestDigest: 'c'.repeat(64) }, testDurationMs: null,
    requestsPerSecond: null, requestCount: null, httpFailures: null });
  expect(result.httpP95?.source).toBe('histogram-estimate'); expect(result.publishedArtifactBytes).toBe(f.descriptors.reduce((n,a) => n + a.bytes, 0));
  const numeric = f.descriptors.find(a => a.kind === 'numeric-final')!;
  expect(f.reads.filter(read => read.id === numeric.artifactId)).toHaveLength(1);
  expect(f.reads.filter(read => read.id !== numeric.artifactId).every(read => read.end - read.start <= 1024)).toBe(true);
});
it('projects measured v4 duration, observed HTTP count/rate/failures and partial window provenance', async () => {
  const f = await fixture(); rewrite(f, 'numeric-final', text => {
    const value = JSON.parse(text); value.version = 4; value.timing = { testRunDurationMs: 2000 };
    value.metrics.totals.push({ metric: 'http_reqs', kind: 'counter', scope: 'execute', tags: { phase: 'execute', request: 'r0' }, total: { kind: 'counter', sum: 8 } },
      { metric: 'http_req_failed', kind: 'rate', scope: 'execute', tags: { phase: 'execute', request: 'r0' }, total: { kind: 'rate', numerator: 2, sampleCount: 8 } });
    value.metrics.windowCoverage = { complete: false, latePoints: 1, markerDelayDroppedBuckets: 0 };
    return JSON.stringify(value);
  });
  const service = f.service(); services.push(service);
  const result = await service.readRunHistorySummary({ id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId }, context());
  expect(result).toMatchObject({ availability: 'ready', testDurationMs: 2000, requestCount: 8, requestsPerSecond: 4,
    httpFailures: 2, httpSamples: 8, httpFailureRatio: 0.25, source: { numericVersion: 4, coverage: { complete: false, latePoints: 1 } } });
  expect(result.source?.numericSha256).toBe(f.descriptors.find(a => a.kind === 'numeric-final')!.sha256);
});
it('rejects malformed query before metadata and never turns digest failure into a usable summary', async () => {
  const f = await fixture(); const list = vi.spyOn(f.reader, 'listRunArtifacts'); const service = f.service(); services.push(service);
  await expect(service.readRunHistorySummary({ ...f.query, extra: true } as never, context())).rejects.toMatchObject({ code: 'invalid_input' });
  expect(list).not.toHaveBeenCalled();
  rewrite(f, 'numeric-final', text => text.replace('"sum":9', '"sum":8'), false);
  await expect(service.readRunHistorySummary({ id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId }, context())).rejects.toThrow();
});
it('retains actual native settlement after caller abort and through service close', async () => {
  const f = await fixture(); let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  const service = createRunMetricsService({ artifacts: f.reader, createDigest: digest, bytes: { read(request, owner) {
    const job = f.bytes.read(request, owner); return { result: job.result, settled: job.settled.then(() => held) };
  } } }); services.push(service);
  const controller = new AbortController(); let settled = false;
  const result = service.readRunHistorySummary({ id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId },
    { signal: controller.signal, deadline: performance.now() + 5000 }).finally(() => { settled = true; });
  const rejected = expect(result).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(f.reads.length).toBeGreaterThan(0)); controller.abort();
    let closed = false; const closing = service.close().then(() => { closed = true; });
    await Promise.resolve(); expect(settled).toBe(false); expect(closed).toBe(false);
    release(); await rejected; await closing;
  } finally { release(); }
});
