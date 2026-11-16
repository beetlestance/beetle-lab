import { expect, it } from 'vitest';
import { createOutputTransfers } from '../../src/application/output-transfer/index.js';
import { OutputTransferError } from '../../src/ports/output-transfer.js';
import { fixture, deferred, pending, turns, id } from './controlled-fixture.js';

it('holds the reserved job through reentrant same-binding capture and captures mutable caller values once', async () => {
  const f = fixture(); const held = deferred<ReturnType<typeof f.adopted>>(); f.metadata.load.mockReturnValue(held.promise);
  const owner = f.create(); let nested: ReturnType<typeof owner.transfer> | undefined;
  const caller = structuredClone(f.binding); let captured = false;
  const input = new Proxy(caller, {getOwnPropertyDescriptor(target, key) {
    if (!captured) {captured = true; nested = owner.transfer(f.binding);}
    return Reflect.getOwnPropertyDescriptor(target, key);
  }});
  const outer = owner.transfer(input); await expect(outer.result).rejects.toMatchObject({code: 'busy'});
  expect(nested).toBeDefined(); expect(f.metadata.load).toHaveBeenCalledTimes(1);
  caller.key.attempt.attemptId = id(999); const closing = owner.close();
  await expect(nested!.result).rejects.toMatchObject({code: 'cancelled'}); expect(await pending(closing)).toBe(true);
  held.resolve(f.adopted()); await closing;
  expect(f.metadata.load.mock.calls[0]).toEqual([f.binding]);
});
it.each(['clock', 'writer'] as const)('fails invalid throwing %s callbacks safely without file work', async callback => {
  const f = fixture(); const throws = () => {throw new Error('/private/canary');};
  const owner = createOutputTransfers({...f.options, ...(callback === 'clock' ? {monotonicNow: throws} : {newWriterId: throws})});
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'invalid_input', message: 'Output transfer failed'});
  expect(f.files.prepare).not.toHaveBeenCalled(); await owner.close();
});
it('blocks file and metadata producers when the writer callback closes reentrantly', async () => {
  const f = fixture();
  const owner = createOutputTransfers({...f.options, newWriterId: () => {void owner.close(); return id(800);}});
  const job = owner.transfer(f.binding); await expect(job.result).rejects.toMatchObject({code: 'cancelled'});
  await owner.close(); expect(f.metadata.claimArtifact).not.toHaveBeenCalled(); expect(f.files.prepare).not.toHaveBeenCalled();
});
it('requires exact protocol organization/workspace before returning pending', async () => {
  const f = fixture(); f.output.source.mockResolvedValue({ok: false, error: {kind: 'protocol', status: 409, protocol: {
    protocolVersion: '1.0', attemptId: f.binding.key.attempt.attemptId, organizationId: id(999),
    workspaceId: f.binding.key.attempt.workspaceId, reason: 'source_pending', retry: 'transport', issues: []}}});
  const owner = f.create(); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'transport'});
  expect(f.metadata.adopt).not.toHaveBeenCalled(); await owner.close();
});
it('retains failed settlement after a positive native result as sticky cleanup', async () => {
  const f = fixture(); const original = f.files.prepare.getMockImplementation()!;
  f.files.prepare.mockImplementation(record => ({...original(record), settled: Promise.reject(new Error('/private/canary'))}));
  const owner = f.create(); const job = owner.transfer(f.binding);
  await expect(job.result).rejects.toMatchObject({code: 'cleanup'});
  expect(await pending(job.settled)).toBe(true); await expect(owner.close()).rejects.toMatchObject({code: 'cleanup'});
  expect(f.metadata.recordProgress).not.toHaveBeenCalled(); expect(() => f.create()).toThrowError(expect.objectContaining({code: 'busy'}));
});
it('rejects a native receipt bound to a different token before recording metadata progress', async () => {
  const f = fixture(); const original = f.files.prepare.getMockImplementation()!;
  f.files.prepare.mockImplementation(record => {const job = original(record); return {...job,
    result: job.result.then(value => ({...value, token: id(999)}))};});
  const owner = f.create(); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'integrity'});
  expect(f.metadata.recordProgress).not.toHaveBeenCalled(); expect(f.files.append).not.toHaveBeenCalled(); await owner.close();
});
it('preserves conflict classification without exposing metadata errors or retrying mutation', async () => {
  const f = fixture(); f.metadata.claimArtifact.mockRejectedValue(Object.assign(new Error('/private/canary'), {code: 'conflict'}));
  const owner = f.create(); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'conflict', message: 'Output transfer failed'});
  expect(f.metadata.claimArtifact).toHaveBeenCalledTimes(1); expect(f.files.prepare).not.toHaveBeenCalled(); await owner.close();
});
it('cancels a held exact chunk original and refuses any append from its late callback', async () => {
  const f = fixture(); const original = f.output.sourceChunk.getMockImplementation()!;
  const held = deferred<Awaited<ReturnType<typeof original>>>();
  f.output.sourceChunk.mockReturnValue(held.promise); const owner = f.create(); const cancel = new AbortController();
  const job = owner.transfer(f.binding, cancel.signal); await turns();
  expect(f.output.sourceChunk).toHaveBeenCalledTimes(1); const selector = f.output.sourceChunk.mock.calls[0]!;
  cancel.abort(); await expect(job.result).rejects.toMatchObject({code: 'cancelled'});
  expect(await pending(job.settled)).toBe(true); held.resolve(await original(...selector)); await job.settled;
  expect(f.files.append).not.toHaveBeenCalled(); expect(f.metadata.beginPublication).not.toHaveBeenCalled(); await owner.close();
});
it('rejects an adoption reply that substitutes source digests before local reads or native work', async () => {
  const f = fixture(); f.metadata.adopt.mockResolvedValue({...f.adopted(), sourceDigest: 'f'.repeat(64)});
  const owner = f.create(); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'integrity'});
  expect(f.metadata.readSource).not.toHaveBeenCalled(); expect(f.files.prepare).not.toHaveBeenCalled(); await owner.close();
});
it('sanitizes mutated typed errors and hostile error carriers', async () => {
  const f = fixture(); const foreign = new OutputTransferError('storage'); foreign.message = '/private/canary';
  f.metadata.load.mockRejectedValueOnce(foreign); const owner = f.create();
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'storage', message: 'Output transfer failed'});
  const hostile = new Proxy(new Error('hidden'), {getPrototypeOf() {throw new Error('/private/canary');}});
  f.metadata.load.mockRejectedValueOnce(hostile);
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'storage', message: 'Output transfer failed'}); await owner.close();
});
