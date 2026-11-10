import { expect, it } from 'vitest';
import type { ClientResult, ProtocolError } from '@beetle/contracts';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import { fixture, deferred, pending, turns, id } from './controlled-fixture.js';

function protocol(f: ReturnType<typeof fixture>, reason: ProtocolError['reason'], retry: ProtocolError['retry'], status = 409): ClientResult<Owned<SourceEnvelope>> {
  return {ok: false, error: {kind: 'protocol', status, protocol: {protocolVersion: '1.0',
    organizationId: f.binding.key.attempt.organizationId, workspaceId: f.binding.key.attempt.workspaceId,
    attemptId: f.binding.key.attempt.attemptId, reason, retry, issues: []}}};
}
it('returns pending only for the exact source_pending disposition', async () => {
  const f = fixture(); f.output.source.mockResolvedValue(protocol(f, 'source_pending', 'transport'));
  const owner = f.create(); await expect(owner.transfer(f.binding).result).resolves.toEqual({kind: 'pending'});
  expect(f.metadata.adopt).not.toHaveBeenCalled(); expect(f.files.prepare).not.toHaveBeenCalled(); await owner.close();
});
it.each([
  ['source_pending', 'transport', 500, 'transport'], ['source_pending', 'never', 409, 'transport'],
  ['source_unavailable', 'never', 409, 'source_unavailable'], ['source_unavailable', 'transport', 409, 'transport'],
] as const)('keeps %s/%s/%i explicit', async (reason, retry, status, code) => {
  const f = fixture(); f.output.source.mockResolvedValue(protocol(f, reason, retry, status)); const owner = f.create();
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code}); await owner.close();
});
it('retains held source original after cancel and suppresses late adoption', async () => {
  const f = fixture(); const held = deferred<ClientResult<Owned<SourceEnvelope>>>(); f.output.source.mockReturnValue(held.promise);
  const owner = f.create(); const cancel = new AbortController(); const job = owner.transfer(f.binding, cancel.signal);
  await turns(); cancel.abort(); await expect(job.result).rejects.toMatchObject({code: 'cancelled'});
  const closing = owner.close(); expect(await pending(closing)).toBe(true); expect(await pending(job.settled)).toBe(true);
  held.resolve({ok: true, value: f.source}); await closing;
  expect(f.metadata.adopt).not.toHaveBeenCalled(); expect(f.files.prepare).not.toHaveBeenCalled();
});
it('retains held metadata mutation, aborts without late file writes, then recovers durable writer', async () => {
  const f = fixture(); const held = deferred<Awaited<ReturnType<typeof f.metadata.claimArtifact>>>();
  const original = f.metadata.claimArtifact.getMockImplementation()!;
  f.metadata.claimArtifact.mockImplementation(async request => {const result = await original(request); await held.promise; return result;});
  const owner = f.create(); const cancel = new AbortController(); const job = owner.transfer(f.binding, cancel.signal);
  await turns(); cancel.abort(); await expect(job.result).rejects.toMatchObject({code: 'cancelled'});
  expect(await pending(job.settled)).toBe(true); expect(f.files.prepare).not.toHaveBeenCalled();
  held.resolve({binding: f.binding, artifact: f.adopted().artifacts[0]!}); await job.settled;
  await expect(owner.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'});
  expect(f.metadata.claimArtifact).toHaveBeenCalledTimes(1); await owner.close();
});
it('recovers publishing directly without preparing, changing writer or requesting chunks', async () => {
  const f = fixture(); const adopted = f.adopted(); f.state = {...adopted, artifacts: adopted.artifacts.map(a => ({...a,
    phase: 'publishing', offset: a.bytes, identity: 'd'.repeat(64), writer: id(888), version: 4}))};
  const owner = f.create(); await expect(owner.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'});
  expect(f.files.prepare).not.toHaveBeenCalled(); expect(f.files.publish).toHaveBeenCalledTimes(1);
  expect(f.metadata.claimArtifact).not.toHaveBeenCalled(); expect(f.output.sourceChunk).not.toHaveBeenCalled();
  expect(f.metadata.recordPublication.mock.calls[0]![0].writerId).toBe(id(888)); await owner.close();
});
it('verifies published state read-only and never replaces its full native identity', async () => {
  const f = fixture(); const owner = f.create(); await owner.transfer(f.binding).result;
  f.metadata.recordPublication.mockClear(); f.files.prepare.mockClear(); f.files.publish.mockClear();
  f.files.append.mockClear(); f.metadata.claimArtifact.mockClear(); f.output.sourceChunk.mockClear();
  await expect(owner.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'});
  expect(f.files.prepare).toHaveBeenCalledTimes(1); expect(f.files.publish).not.toHaveBeenCalled();
  expect(f.files.append).not.toHaveBeenCalled(); expect(f.metadata.recordPublication).not.toHaveBeenCalled();
  expect(f.metadata.claimArtifact).not.toHaveBeenCalled(); expect(f.output.sourceChunk).not.toHaveBeenCalled();
  const prepare = f.files.prepare.getMockImplementation()!;
  f.files.prepare.mockImplementation(record => {const job = prepare(record); return {...job,
    result: job.result.then(receipt => ({...receipt, identity: 'f'.repeat(64)}))};});
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'integrity'}); await owner.close();
});
it('refuses mismatched adopted descriptors before any native work', async () => {
  const f = fixture(); const adopted = f.adopted(); f.state = {...adopted, artifacts: adopted.artifacts.map(a => ({...a, bytes: a.bytes + 1}))};
  const owner = f.create(); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'integrity'});
  expect(f.files.prepare).not.toHaveBeenCalled(); expect(f.metadata.claimArtifact).not.toHaveBeenCalled(); await owner.close();
});
it('refuses a foreign full binding and malformed chunk before append', async () => {
  const f = fixture(); f.metadata.load.mockResolvedValue({...f.adopted(), binding: {...f.binding, journalAuthority: id(999)}});
  const owner = f.create(); await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'integrity'});
  expect(f.metadata.readSource).not.toHaveBeenCalled(); f.metadata.load.mockImplementation(async () => f.state);
  const chunks = f.output.sourceChunk.getMockImplementation()!;
  f.output.sourceChunk.mockImplementation(async (request, total) => {const response = await chunks(request, total);
    if (!response.ok) return response; return {...response, value: {...response.value, base64: '/x=='}};});
  await expect(owner.transfer(f.binding).result).rejects.toMatchObject({code: 'integrity'});
  expect(f.files.append).not.toHaveBeenCalled(); await owner.close();
});
it('stops after unknown progress outcome and reconciles the existing writer on the next job', async () => {
  const f = fixture(); const original = f.metadata.recordProgress.getMockImplementation()!;
  f.metadata.recordProgress.mockImplementationOnce(async request => {await original(request); throw new Error('private canary');});
  const owner = f.create(); const failed = owner.transfer(f.binding);
  await expect(failed.result).rejects.toMatchObject({code: 'storage', message: 'Output transfer failed'}); await failed.settled;
  expect(f.metadata.recordProgress).toHaveBeenCalledTimes(1); expect(f.files.append).not.toHaveBeenCalled();
  await expect(owner.transfer(f.binding).result).resolves.toMatchObject({kind: 'published'});
  expect(f.metadata.claimArtifact).toHaveBeenCalledTimes(1); await owner.close();
});
