import { expect, it } from 'vitest';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
import { fixture, context, digest } from './fixture.js';
import { deferred, pending } from '../files/output-bytes/fixture.js';
it('retains held metadata after abort, refuses overlap and drains it on shutdown', async () => {
  const f = await fixture(); const hold = deferred(); const entered = deferred();
  const s = createRunMetricsService({artifacts: {...f.reader, async listRunArtifacts(q) {entered.resolve(); await hold.promise; return f.reader.listRunArtifacts(q);}}, bytes: f.bytes, createDigest: digest});
  const c = new AbortController(); const read = s.reader.listRunMetricSeries(f.query, {...context(), signal: c.signal});
  await entered.promise; c.abort(); await expect(read).rejects.toThrow();
  await expect(s.reader.listRunMetricSeries(f.query, context())).rejects.toThrow();
  const close = s.close(); expect(await pending(close)).toBe(true); hold.resolve(); await close;
  await expect(s.reader.listRunMetricSeries(f.query, context())).rejects.toThrow();
});
it('owns native result AND late settlement while cancellation remains responsive', async () => {
  const f = await fixture(); const hold = deferred(); const entered = deferred();
  const s = createRunMetricsService({artifacts: f.reader, bytes: {read() {entered.resolve(); return {result: Promise.resolve(), settled: hold.promise};}}, createDigest: digest});
  const c = new AbortController(); const read = s.reader.listRunMetricSeries(f.query, {...context(), signal: c.signal});
  await entered.promise; c.abort(); await expect(read).rejects.toThrow();
  const close = s.close(); expect(await pending(close)).toBe(true); hold.resolve(); await close;
});
it('captures reader/capabilities and never substitutes empty ready reads without bytes', async () => {
  const f = await fixture(); const s = createRunMetricsService({artifacts: f.reader});
  await expect(s.reader.listRunMetricSeries(f.query, context())).rejects.toThrow(); await s.close();
  const pendingReader = {...f.reader, async listRunArtifacts(q: typeof f.query) {return {...await f.reader.listRunArtifacts(q), availability: 'pending' as const, manifestDigest: null, items: []};}};
  const metadata = createRunMetricsService({artifacts: pendingReader});
  expect(await metadata.reader.listRunMetricSeries(f.query, context())).toMatchObject({availability: 'pending', items: []}); await metadata.close();
});
it('captures bounded original query before validation and asynchronous metadata work', async () => {
  const f = await fixture(); const hold = deferred(); const entered = deferred(); let seen = '';
  const s = createRunMetricsService({artifacts: {...f.reader, async listRunArtifacts(q) {seen = q.id; entered.resolve(); await hold.promise; return f.reader.listRunArtifacts(q);}}, bytes: f.bytes, createDigest: digest});
  const q = {...f.query, scope: {...f.query.scope}}; const original = q.id;
  const read = s.reader.listRunMetricSeries(q, context()); q.id = '00000000-0000-4000-8000-000000000999';
  await entered.promise; expect(seen).toBe(original); hold.resolve(); expect((await read).id).toBe(original);
  let invoked = false;
  await expect(s.reader.listRunMetricSeries({...f.query, get scope() {invoked = true; return f.query.scope;}}, context())).rejects.toThrow();
  expect(invoked).toBe(false); await s.close();
});
