import { expect, it } from 'vitest';
import { fixture, metric, context, deferred, uuid } from './fixture.js';
it('holds one original through ignored-abort metadata, fences new calls and drains shutdown', async () => {
  const f = fixture(); const hold = deferred<void>(); const issued = deferred<void>(); const read = f.options.runs.getRun;
  f.options.runs.getRun = async key => {issued.resolve(); await hold.promise; return read(key);};
  const service = f.service(); const controller = new AbortController(); const pending = service.compare(f.request, context(controller.signal));
  const rejected = expect(pending).rejects.toThrow(); await issued.promise; controller.abort();
  let settled = false; void pending.then(() => {settled = true;}, () => {settled = true;}); await Promise.resolve(); expect(settled).toBe(false);
  await expect(service.compare(f.request, context())).rejects.toMatchObject({code: 'busy'});
  const close = service.close(); let closed = false; void close.then(() => {closed = true;}); await Promise.resolve(); expect(closed).toBe(false);
  hold.resolve(); await rejected; await close; expect(f.calls.filter(call => call.startsWith('revision'))).toEqual([]); expect(f.lookups).toEqual([]);
});
it('holds actual lookup originals and refuses to publish their late success after cancellation', async () => {
  const f = fixture(); const hold = deferred<void>(); const issued = deferred<void>(); const read = f.options.metrics.lookupRunMetricSeries;
  f.options.metrics.lookupRunMetricSeries = async (query, c) => {issued.resolve(); await hold.promise; return read(query, c);};
  const service = f.service(); const controller = new AbortController();
  const pending = service.compare({...f.request, metric}, context(controller.signal)); const rejected = expect(pending).rejects.toThrow();
  await issued.promise; controller.abort();
  let settled = false; void pending.then(() => {settled = true;}, () => {settled = true;}); await Promise.resolve(); expect(settled).toBe(false);
  await expect(service.compare(f.request, context())).rejects.toMatchObject({code: 'busy'});
  let closed = false; const close = service.close().then(() => {closed = true;}); await Promise.resolve(); expect(closed).toBe(false);
  hold.resolve(); await rejected; await close; expect(f.lookups).toHaveLength(1);
});
it('captures request identity before awaiting metadata and rejects expired callers before reads', async () => {
  const f = fixture(); const service = f.service(); const expected = [...f.request.runIds];
  try {
    const pending = service.compare(f.request, context()); f.request.runIds[0] = uuid(999);
    expect((await pending).items.map(item => item.run.id)).toEqual(expected);
    const calls = f.calls.length;
    await expect(service.compare({...f.request, runIds: expected}, {signal: new AbortController().signal, deadline: performance.now() - 1})).rejects.toThrow();
    expect(f.calls).toHaveLength(calls);
  } finally {await service.close();}
});
