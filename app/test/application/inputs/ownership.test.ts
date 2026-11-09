import { expect, it, vi } from 'vitest';
import { InputByteError } from '../../../src/ports/input-bytes.js';
import type { InputByteJob } from '../../../src/ports/input-bytes.js';
import type { InputRecord } from '../../../src/ports/inputs.js';
import { storageFixture } from '../../storage/fixture.js';
import { creation, transition, setup, key, source, deferred, turn, uuid, scope } from './fixture.js';

const fixture = storageFixture();
it('retains two original byte jobs and canonical key ownership after cancelled replies until custody settles', async () => {
  const { service, model } = await setup(fixture);
  const a = await service.control(creation(90)) as InputRecord;
  const b = await service.control(creation(91)) as InputRecord;
  const c = await service.control(creation(92)) as InputRecord;
  const settled = [deferred<void>(), deferred<void>()]; let sequence = 0;
  model.bytes.append = () => ({ result: Promise.reject(new InputByteError('cancelled')), settled: settled[sequence++]!.promise });
  await expect(service.append(key(a), 0, source('abc'))).rejects.toMatchObject({ code: 'cancelled' });
  const lazy = vi.fn(source('abc'));
  await expect(service.append({ id: a.id.toUpperCase(), scope: { ...scope, organizationId: scope.organizationId.toUpperCase() } }, 0, lazy)).rejects.toMatchObject({ code: 'busy' });
  await expect(service.append(key(b), 0, source('abc'))).rejects.toMatchObject({ code: 'cancelled' });
  await expect(service.append(key(c), 0, lazy)).rejects.toMatchObject({ code: 'busy' }); expect(lazy).not.toHaveBeenCalled();
  settled[0]!.resolve(); await turn();
  model.bytes.append = (_record, _offset, read) => {
    const result = read().then(chunk => chunk.length); return { result, settled: result.then(() => undefined) };
  };
  expect(await service.append(key(c), 0, source('abc'))).toMatchObject({ offset: 3 });
  settled[1]!.resolve(); await service.close();
});
it('does not advance an early successful result before native settlement, and close aborts and drains the original', async () => {
  const { service, model, metadata } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  const settled = deferred<void>(); const entered = deferred<void>(); let signal: AbortSignal | undefined;
  model.bytes.append = (_record, offset, read, context) => {
    signal = context.signal;
    return { result: read().then(chunk => { entered.resolve(); return offset + chunk.length; }), settled: settled.promise };
  };
  const appending = service.append(key(record), 0, source('abc')); const outcome = appending.catch(error => error);
  await entered.promise; await turn(); expect(await metadata.inputs.get(key(record))).toMatchObject({ offset: 0, version: 1 });
  let drained = false; const closing = service.close().then(() => { drained = true; });
  expect(signal?.aborted).toBe(true); await turn(); expect(drained).toBe(false);
  await expect(service.control(creation(91))).rejects.toMatchObject({ code: 'closed' });
  settled.resolve(); expect(await outcome).toMatchObject({ code: 'cancelled' }); await closing;
  expect(await metadata.inputs.get(key(record))).toMatchObject({ offset: 0, version: 1 });
});
it('retains a lazy source original when a misbehaving native job returns failure before that source settles', async () => {
  const { service, model } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  const body = deferred<Uint8Array>(); const entered = deferred<void>();
  model.bytes.append = (_record, _offset, read) => {
    void read(); entered.resolve(); return { result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() };
  };
  await expect(service.append(key(record), 0, () => body.promise)).rejects.toMatchObject({ code: 'io' }); await entered.promise;
  await expect(service.control(transition(record, 'deleteInput'))).rejects.toMatchObject({ code: 'busy' });
  let closed = false; const closing = service.close().then(() => { closed = true; }); await turn(); expect(closed).toBe(false);
  body.resolve(Buffer.from('abc')); await closing;
});
it('retains a sink original and captured method through an early failed native result', async () => {
  const { service, model } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  const uploaded = await service.append(key(record), 0, source('abc')); await service.control(transition(uploaded, 'sealInput'));
  const held = deferred<void>(); const entered = deferred<void>(); const sink = { write: vi.fn(async () => { entered.resolve(); await held.promise; }) };
  model.bytes.read = (_record, _range, consumer) => {
    void consumer.write(Buffer.from('abc')); return { result: Promise.reject(new InputByteError('io')), settled: Promise.resolve() };
  };
  const reading = service.read(key(record), undefined, sink); sink.write = vi.fn(async () => undefined);
  await expect(reading).rejects.toMatchObject({ code: 'io' }); await entered.promise; expect(sink.write).not.toHaveBeenCalled();
  await expect(service.control(transition(await service.get(key(record)), 'deleteInput'))).rejects.toMatchObject({ code: 'busy' });
  held.resolve(); await turn(); await service.close();
});
it('quarantines cleanup failure, retains job custody and fences intake while close remains pending', async () => {
  const { service, model, metadata } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  const held = deferred<void>(); let closed = false;
  model.bytes.append = () => ({ result: Promise.reject(new InputByteError('cleanup')), settled: held.promise });
  await expect(service.append(key(record), 0, source('abc'))).rejects.toMatchObject({ code: 'cleanup' });
  const closing = service.close().then(() => { closed = true; }); void closing;
  await expect(service.get(key(record))).rejects.toMatchObject({ code: 'closed' }); await turn(); expect(closed).toBe(false);
  held.resolve(); await turn(); expect(closed).toBe(false);
  expect(await metadata.inputs.get(key(record))).toMatchObject({ state: 'staging', offset: 0 });
});
it('quarantines a rejected custody promise independently of the byte result', async () => {
  const { service, model } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  model.bytes.append = () => ({ result: Promise.reject(new InputByteError('io')), settled: Promise.reject(new Error('unproven cleanup')) });
  await expect(service.append(key(record), 0, source('abc'))).rejects.toMatchObject({ code: 'io' });
  await expect(service.control(creation(91))).rejects.toMatchObject({ code: 'closed' });
  let closed = false; void service.close().then(() => { closed = true; }); await turn(); expect(closed).toBe(false);
});
it('does not fail conclusive missing custody until the original settlement, then compares the exact version', async () => {
  const { service, model, metadata } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  const settled = deferred<void>(); const entered = deferred<void>();
  model.bytes.append = () => { entered.resolve(); return { result: Promise.reject(new InputByteError('custody_missing')), settled: settled.promise }; };
  const result = service.append(key(record), 0, source('abc')); const failure = result.catch(error => error);
  await entered.promise; await turn(); expect(await metadata.inputs.get(key(record))).toMatchObject({ state: 'staging', version: 1 });
  await expect(service.append(key(record), 0, source('abc'))).rejects.toMatchObject({ code: 'busy' });
  settled.resolve(); expect(await failure).toMatchObject({ code: 'custody_missing' });
  expect(await service.get(key(record))).toMatchObject({ state: 'failed', version: 2, reason: 'custody_missing' }); await service.close();
});
it('captures one caller signal and keeps cancelled originals alive through close', async () => {
  const { service, model } = await setup(fixture); const record = await service.control(creation()) as InputRecord;
  const first = new AbortController(); const second = new AbortController(); let reads = 0;
  const context = { get signal() { return reads++ === 0 ? first.signal : second.signal; } };
  const native = deferred<number>(); const settled = deferred<void>(); const entered = deferred<void>(); let seen: AbortSignal | undefined;
  model.bytes.append = (_record, _offset, _source, options): InputByteJob<number> => {
    seen = options.signal; entered.resolve(); return { result: native.promise, settled: settled.promise };
  };
  const response = service.append(key(record), 0, source('abc'), context).catch(error => error);
  await entered.promise; expect(reads).toBe(1); first.abort(); expect(seen?.aborted).toBe(true);
  let closed = false; const closing = service.close().then(() => { closed = true; }); await turn(); expect(closed).toBe(false);
  native.reject(new InputByteError('cancelled')); expect(await response).toMatchObject({ code: 'cancelled' }); await turn(); expect(closed).toBe(false);
  settled.resolve(); await closing;
});
it('keeps read backpressure bounded and captures range/key before the first metadata await', async () => {
  const { service, model, store } = await setup(fixture);
  const record = await service.control(creation()) as InputRecord;
  const uploaded = await service.append(key(record), 0, source('abc')); await service.control(transition(uploaded, 'sealInput'));
  const barrier = deferred<InputRecord>(); const captured = deferred<void>(); const originalGet = store.get;
  store.get = async capturedKey => { const row = await originalGet(capturedKey); captured.resolve(); await barrier.promise; return row; };
  const range = { start: 0, endExclusive: 2 }; const inputKey = key(record); const held = deferred<void>(); const entered = deferred<void>();
  const readPort = vi.spyOn(model.bytes, 'read');
  const reading = service.read(inputKey, range, { write: async data => { expect(Buffer.from(data).toString()).toBe('ab'); entered.resolve(); await held.promise; } });
  await captured.promise; range.start = 2; range.endExclusive = 3; inputKey.id = uuid(999); barrier.resolve(record);
  await entered.promise; expect(readPort.mock.calls[0]?.[1]).toEqual({ start: 0, endExclusive: 2 });
  let done = false; void reading.then(() => { done = true; }); await turn(); expect(done).toBe(false);
  held.resolve(); await reading; await service.close();
});
