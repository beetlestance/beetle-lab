import { expect, it } from 'vitest';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
import { fixture, context, digest } from './fixture.js';
import { deferred, pending } from '../files/output-bytes/fixture.js';

async function heldHistory() {
  const f = await fixture(); const held = deferred(); const entered = deferred(); let metadata = 0;
  const service = createRunMetricsService({ artifacts: { ...f.reader, async listRunArtifacts(q) {
    metadata++;
    if (metadata === 1) { entered.resolve(); await held.promise; }
    return f.reader.listRunArtifacts(q);
  } }, bytes: f.bytes, createDigest: digest });
  const { id, scope, attemptId } = f.query;
  const history = service.readRunHistorySummary({ id, scope, attemptId }, context());
  await entered.promise;
  return { f, held, service, history, metadata: () => metadata };
}

it('hands the single reader from background history to one waiting public catalogue without overlapping IO', async () => {
  const h = await heldHistory();
  const read = h.service.reader.listRunMetricSeries(h.f.query, context());
  void read.catch(() => undefined);
  try {
    expect(await pending(read)).toBe(true);
    expect(h.metadata()).toBe(1);
    await expect(h.service.reader.listRunMetricSeries(h.f.query, context())).rejects.toMatchObject({ code: 'busy' });
    h.held.resolve();
    expect(await h.history).toMatchObject({ availability: 'ready' });
    expect(await read).toMatchObject({ availability: 'ready', id: h.f.query.id });
    expect(h.metadata()).toBe(2);
  } finally {
    h.held.resolve(); await Promise.allSettled([h.history, read]); await h.service.close();
  }
});

it('retires a cancelled waiter without IO and admits one replacement behind the same history original', async () => {
  const h = await heldHistory(); const controller = new AbortController();
  const read = h.service.reader.listRunMetricSeries(h.f.query, { ...context(), signal: controller.signal });
  try {
    controller.abort(); await expect(read).rejects.toMatchObject({ code: 'unavailable' });
    expect(h.metadata()).toBe(1);
    const next = h.service.reader.listRunMetricSeries(h.f.query, context());
    expect(await pending(next)).toBe(true);
    h.held.resolve(); await h.history;
    expect(await next).toMatchObject({ availability: 'ready' }); expect(h.metadata()).toBe(2);
  } finally { h.held.resolve(); await Promise.allSettled([h.history, read]); await h.service.close(); }
});

it('captures the waiting query before the caller can mutate it', async () => {
  const h = await heldHistory(); const query = { ...h.f.query, scope: { ...h.f.query.scope } };
  const expected = query.id; const read = h.service.reader.listRunMetricSeries(query, context());
  try {
    query.id = '00000000-0000-4000-8000-000000000999';
    h.held.resolve(); await h.history;
    expect(await read).toMatchObject({ id: expected });
  } finally { h.held.resolve(); await Promise.allSettled([h.history, read]); await h.service.close(); }
});

it('expires a waiting request on its original deadline without reading its archive', async () => {
  const h = await heldHistory();
  const read = h.service.reader.listRunMetricSeries(h.f.query, { ...context(), deadline: performance.now() + 20 });
  try {
    await expect(read).rejects.toThrow(); expect(h.metadata()).toBe(1);
    h.held.resolve(); await h.history; expect(h.metadata()).toBe(1);
  } finally { h.held.resolve(); await Promise.allSettled([h.history, read]); await h.service.close(); }
});

it('cancels the waiter on close and drains the history original without promoting another read', async () => {
  const h = await heldHistory(); const read = h.service.reader.listRunMetricSeries(h.f.query, context());
  const close = h.service.close();
  try {
    await expect(read).rejects.toMatchObject({ code: 'unavailable' });
    expect(await pending(close)).toBe(true); expect(h.metadata()).toBe(1);
  } finally { h.held.resolve(); await Promise.allSettled([h.history, read, close]); }
  expect(h.metadata()).toBe(1);
});

it('hands off to exact lookup through the same physical reader', async () => {
  const h = await heldHistory(); const controller = new AbortController();
  const { id, scope, attemptId } = h.f.query;
  const lookup = h.service.lookupRunMetricSeries({ id, scope, attemptId,
    metric: { metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: { phase: 'execute', request: 'r0' } },
  }, { ...context(), signal: controller.signal });
  try {
    expect(await pending(lookup)).toBe(true); h.held.resolve(); await h.history;
    expect(await lookup).toMatchObject({ source: { availability: 'ready' } });
    expect(h.metadata()).toBe(2);
  } finally { h.held.resolve(); await Promise.allSettled([h.history, lookup]); await h.service.close(); }
});

it('retains a promoted lookup original after cancellation until its metadata settles', async () => {
  const f = await fixture(); const historyEntered = deferred(); const historyHeld = deferred();
  const lookupEntered = deferred(); const lookupHeld = deferred(); let calls = 0;
  const service = createRunMetricsService({ artifacts: { ...f.reader, async listRunArtifacts(q) {
    calls++;
    if (calls === 1) { historyEntered.resolve(); await historyHeld.promise; }
    if (calls === 2) { lookupEntered.resolve(); await lookupHeld.promise; }
    return f.reader.listRunArtifacts(q);
  } }, bytes: f.bytes, createDigest: digest });
  const { id, scope, attemptId } = f.query;
  const history = service.readRunHistorySummary({ id, scope, attemptId }, context());
  await historyEntered.promise; const controller = new AbortController();
  const lookup = service.lookupRunMetricSeries({ id, scope, attemptId,
    metric: { metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: { phase: 'execute', request: 'r0' } },
  }, { ...context(), signal: controller.signal });
  void lookup.catch(() => undefined);
  try {
    historyHeld.resolve(); await history; await lookupEntered.promise;
    controller.abort(); expect(await pending(lookup)).toBe(true);
    await expect(service.reader.listRunMetricSeries(f.query, context())).rejects.toMatchObject({ code: 'busy' });
    const close = service.close(); expect(await pending(close)).toBe(true);
    lookupHeld.resolve(); await expect(lookup).rejects.toThrow(); await close;
    expect(calls).toBe(2);
  } finally { historyHeld.resolve(); lookupHeld.resolve(); await Promise.allSettled([history, lookup]); await service.close(); }
});
