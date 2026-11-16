import { expect, it } from 'vitest';
import { fixture, context } from './fixture.js';
import type { RunMetricKey } from '@beetle/contracts/api';
function key(f: Awaited<ReturnType<typeof fixture>>) {return {id: f.query.id, scope: f.query.scope, attemptId: f.query.attemptId};}
const metric: RunMetricKey = {metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: {phase: 'execute', request: 'r0'}};
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(pass => {resolve = pass;}); return {promise, resolve};}
it('selects one exact identity through the existing verified numeric/archive owner without catalogue paging', async () => {
  const f = await fixture(); const list = f.reader.listRunArtifacts;
  let calls = 0; f.reader.listRunArtifacts = async query => {calls++; return list(query);}; const service = f.service();
  try {
    const result = await service.lookupRunMetricSeries({...key(f), metric}, context());
    expect(result.source).toMatchObject({availability: 'ready', totalSeries: 1, measurementSourceTimeMs: 1800000000000});
    expect(result.series).toMatchObject({ordinal: 0, metric: 'http_req_duration', total: {kind: 'trend', count: 3, mean: 3}});
    expect(calls).toBe(1);
    const missing = await service.lookupRunMetricSeries({...key(f), metric: {...metric, tags: {phase: 'execute', request: 'r1'}}}, context());
    expect(missing.source.availability).toBe('ready'); expect(missing.series).toBeNull(); expect(calls).toBe(2);
  } finally {await service.close();}
});
it('retains its actual metadata original after cancellation and refuses other history/lookup work until it settles', async () => {
  const f = await fixture(); const hold = deferred<void>(); const issued = deferred<void>(); const read = f.reader.listRunArtifacts;
  f.reader.listRunArtifacts = async query => {issued.resolve(); await hold.promise; return read(query);};
  const service = f.service(); const controller = new AbortController();
  const original = service.lookupRunMetricSeries({...key(f), metric}, {...context(), signal: controller.signal});
  const rejected = expect(original).rejects.toThrow(); await issued.promise; controller.abort();
  let settled = false; void original.then(() => {settled = true;}, () => {settled = true;}); await Promise.resolve(); expect(settled).toBe(false);
  await expect(service.reader.listRunMetricSeries(f.query, context())).rejects.toMatchObject({code: 'busy'});
  const closing = service.close(); let closed = false; void closing.then(() => {closed = true;}); await Promise.resolve(); expect(closed).toBe(false);
  hold.resolve(); await rejected; await closing; expect(f.reads).toEqual([]);
});
it('refuses invalid/oversized identity and unknown lookup fields before any metadata or byte read', async () => {
  const f = await fixture(); let calls = 0; f.reader.listRunArtifacts = async () => {calls++; throw new Error('Unexpected metadata');};
  const service = f.service();
  try {
    for (const query of [{...key(f), metric: {...metric, tags: {phase: 'prepare' as const}}},
      {...key(f), metric: {...metric, metric: 'x'.repeat(129)}}, {...key(f), metric, extra: true}]) {
      await expect(service.lookupRunMetricSeries(query as Parameters<typeof service.lookupRunMetricSeries>[0], context())).rejects.toMatchObject({code: 'invalid_input'});
    }
    expect(calls).toBe(0); expect(f.reads).toEqual([]);
  } finally {await service.close();}
});
