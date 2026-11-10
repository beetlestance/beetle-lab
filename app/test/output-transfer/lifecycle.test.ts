import { expect, it } from 'vitest';
import { OutputByteError } from '../../src/ports/output-bytes.js';
import type { OutputFileReceipt } from '../../src/ports/output-bytes.js';
import { createOutputTransfers } from '../../src/application/output-transfer/index.js';
import { fixture, deferred, turns, pending, id, fileJob } from './controlled-fixture.js';

it('publishes serially through narrow capabilities, retains identity, and leaves dependencies open', async () => {
  const f = fixture(); const owner = f.create(); const job = owner.transfer(f.binding);
  await expect(job.result).resolves.toMatchObject({kind: 'published', binding: f.binding}); await job.settled;
  expect(f.output.sourceChunk).toHaveBeenCalledTimes(1); expect(f.files.append).toHaveBeenCalledTimes(1);
  expect(f.metadata.recordPublication).toHaveBeenCalledTimes(1);
  const closing = owner.close(); expect(owner.close()).toBe(closing); await closing;
  for (const dependency of [f.gateway, f.files, f.metadata]) expect(dependency.close).not.toHaveBeenCalled();
  expect(f.gateway.attempt).not.toHaveBeenCalled(); expect(f.gateway.capabilities).not.toHaveBeenCalled();
  expect(f.files.prepare.mock.calls[0]![0].binding).toEqual(f.binding);
});
it('reserves two jobs before foreign callbacks, rejects duplicate originals, and drains held metadata on close', async () => {
  const f = fixture(); const held = deferred<ReturnType<typeof f.adopted>>(); f.metadata.load.mockImplementation(() => held.promise);
  const owner = f.create(); const first = owner.transfer(f.binding);
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'busy'});
  const second = owner.transfer({...f.binding, key: {...f.binding.key, runId: id(901)}});
  await expect(owner.transfer({...f.binding, journalAuthority: id(902)}).result).rejects.toMatchObject({code: 'busy'});
  const closing = owner.close(); await expect(first.result).rejects.toMatchObject({code: 'cancelled'});
  await expect(second.result).rejects.toMatchObject({code: 'cancelled'});
  expect(await pending(first.settled)).toBe(true); expect(await pending(closing)).toBe(true);
  expect(() => f.create()).toThrowError(expect.objectContaining({code: 'busy'}));
  held.resolve(f.adopted()); await closing; await first.settled; await second.settled;
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'closed'});
  await f.create().close(); expect(f.metadata.readSource).not.toHaveBeenCalled();
});
it('reserves directly through hostile capture and closes synchronously during reentry', async () => {
  const f = fixture(); const owner = f.create(); let reentered = false;
  const input = new Proxy(f.binding, {getOwnPropertyDescriptor(target, name) {
    if (!reentered) {reentered = true; void owner.close();} return Reflect.getOwnPropertyDescriptor(target, name);
  }});
  const job = owner.transfer(input); await expect(job.result).rejects.toBeDefined(); await job.settled; await owner.close();
  expect(f.metadata.load).not.toHaveBeenCalled(); expect(f.files.prepare).not.toHaveBeenCalled();
});
it('rejects fake AbortSignals and getter bindings without executing getters', async () => {
  const f = fixture(); const owner = f.create(); let observed = false;
  const input = {...f.binding, get key() {observed = true; return f.binding.key;}};
  await expect(owner.transfer(input).result).rejects.toMatchObject({code: 'invalid_input'});
  await expect(owner.transfer(f.binding, Object.create(AbortSignal.prototype) as AbortSignal).result).rejects.toMatchObject({code: 'invalid_input'});
  expect(observed).toBe(false); expect(f.metadata.load).not.toHaveBeenCalled(); await owner.close();
});
it('waits native result AND settlement before progress and fences late callbacks after cancellation', async () => {
  const f = fixture(); const held = deferred<void>(); const original = f.files.prepare.getMockImplementation()!;
  f.files.prepare.mockImplementation(record => ({...original(record), settled: held.promise}));
  const owner = f.create(); const cancel = new AbortController(); const job = owner.transfer(f.binding, cancel.signal);
  await turns(); expect(f.metadata.recordProgress).not.toHaveBeenCalled(); expect(await pending(job.result)).toBe(true);
  cancel.abort(); await expect(job.result).rejects.toMatchObject({code: 'cancelled'});
  expect(await pending(job.settled)).toBe(true); held.resolve(); await job.settled;
  expect(f.metadata.recordProgress).not.toHaveBeenCalled(); expect(f.files.append).not.toHaveBeenCalled(); await owner.close();
});
it('keeps failed native cleanup sticky, settlement pending, and prevents parent replacement', async () => {
  const f = fixture(); const never = new Promise<void>(() => {});
  f.files.prepare.mockImplementation(() => ({result: Promise.reject(new OutputByteError('cleanup')), settled: never}));
  const owner = f.create(); const job = owner.transfer(f.binding);
  await expect(job.result).rejects.toMatchObject({code: 'cleanup'});
  expect(await pending(job.settled)).toBe(true); const closing = owner.close();
  expect(owner.close()).toBe(closing); await expect(closing).rejects.toMatchObject({code: 'cleanup'});
  expect(() => f.create()).toThrowError(expect.objectContaining({code: 'busy'}));
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'closed'});
});
it('retains a rejected native result until its exact settlement without issuing progress or replacement', async () => {
  const f = fixture(); const settle = deferred<void>();
  f.files.prepare.mockImplementation(() => ({result: Promise.reject(new OutputByteError('io')), settled: settle.promise}));
  const owner = f.create(); const job = owner.transfer(f.binding); await expect(job.result).rejects.toMatchObject({code: 'storage'});
  expect(await pending(job.settled)).toBe(true); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'busy'});
  expect(f.metadata.recordProgress).not.toHaveBeenCalled(); settle.resolve(); await job.settled; await owner.close();
});
it('refuses publication until the exact native publication settlement', async () => {
  const f = fixture(); const settle = deferred<void>(); const value = deferred<OutputFileReceipt>();
  f.files.publish.mockImplementation(() => ({result: value.promise, settled: settle.promise}));
  const owner = f.create(); const job = owner.transfer(f.binding); await turns();
  const record = f.files.publish.mock.calls[0]![0]; value.resolve({token: record.artifact.token, offset: record.artifact.bytes,
    phase: 'published', identity: 'e'.repeat(64)}); await turns();
  expect(f.metadata.recordPublication).not.toHaveBeenCalled(); expect(await pending(job.result)).toBe(true);
  settle.resolve(); await expect(job.result).resolves.toMatchObject({kind: 'published'}); await job.settled; await owner.close();
});
it('refuses invalid reserve, writer UUID and backwards clocks with safe fixed errors', async () => {
  const f = fixture(); expect(() => createOutputTransfers({...f.options, freeSpaceReserveBytes: -1})).toThrowError(expect.objectContaining({code: 'invalid_input'}));
  let now = 10; const owner = createOutputTransfers({...f.options, monotonicNow: () => now--});
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'invalid_input'}); await owner.close();
  const fresh = fixture(); const other = createOutputTransfers({...fresh.options, newWriterId: () => '/private/canary'});
  await expect(other.transfer(fresh.binding).result).rejects.toMatchObject({code: 'invalid_input', message: 'Output transfer failed'});
  expect(fresh.files.prepare).not.toHaveBeenCalled(); await other.close();
});
it('uses fresh bounded deadlines for every native original', async () => {
  const f = fixture(); let now = 100;
  const files = {prepare: (r: Parameters<typeof f.files.prepare>[0], c: {deadline: number}) => {
    expect(c.deadline - now).toBeLessThanOrEqual(300000); expect(c.deadline).toBeGreaterThan(now); now += 1000;
    return fileJob({token: r.artifact.token, offset: r.artifact.bytes, phase: 'transferring' as const, identity: 'd'.repeat(64)});
  }, append: f.files.append, publish: f.files.publish};
  const owner = createOutputTransfers({...f.options, files, monotonicNow: () => now});
  await expect(owner.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'}); await owner.close();
});
