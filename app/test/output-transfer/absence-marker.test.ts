import { expect, it } from 'vitest';
import type { ClientResult, ProtocolError } from '@beetle/contracts';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import { sourceReply } from '../../src/application/output-transfer/source.js';
import { deferred, fixture, id, pending } from './controlled-fixture.js';

function marker(patch: Partial<ProtocolError> = {}, status = 409): ClientResult<Owned<SourceEnvelope>> {
  const f = fixture(); const scope = f.binding.key.attempt;
  return { ok: false, error: { kind: 'protocol', status, protocol: {
    protocolVersion: '1.0', organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    attemptId: scope.attemptId, reason: 'source_absent', retry: 'never', issues: [], ...patch,
  } } };
}
it('hands off an exact initial source absence only after the source original settles, without artifact custody', async () => {
  const f = fixture(); const original = deferred<ClientResult<Owned<SourceEnvelope>>>();
  f.output.source.mockReturnValueOnce(original.promise);
  const transfers = f.create(); const job = transfers.transfer(f.binding);
  expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true);
  expect(f.output.source).toHaveBeenCalledTimes(1); original.resolve(marker());
  await expect(job.result).rejects.toMatchObject({ code: 'source_absent' });
  await expect(job.settled).resolves.toBeUndefined();
  expect(f.metadata.adopt).not.toHaveBeenCalled(); expect(f.metadata.claimArtifact).not.toHaveBeenCalled();
  expect(f.files.prepare).not.toHaveBeenCalled(); expect(f.output.sourceChunk).not.toHaveBeenCalled();
  await transfers.close();
});
it.each([
  { patch: { organizationId: id(801) } }, { patch: { workspaceId: id(802) } },
  { patch: { attemptId: id(803) } },
  { patch: { retry: 'transport' as const } }, { patch: { retry: 'setup' as const } },
  { patch: {}, status: 404 }, { patch: {}, status: 503 },
])('does not hand off a mismatched or non-definitive marker %#', ({ patch, status }) => {
  const f = fixture(); expect(() => sourceReply(marker(patch, status), f.binding, true))
    .toThrow(expect.objectContaining({ code: 'transport' }));
});
it('never changes an adopted source into absence from a later chunk response', () => {
  const f = fixture(); expect(() => sourceReply(marker(), f.binding))
    .toThrow(expect.objectContaining({ code: 'transport' }));
});
it('requires an attempt-scoped marker even when the other scope fields match', () => {
  const f = fixture(); const reply = marker();
  if (reply.ok || !reply.error.protocol) throw new Error('Expected synthetic protocol marker');
  delete reply.error.protocol.attemptId;
  expect(() => sourceReply(reply, f.binding, true)).toThrow(expect.objectContaining({ code: 'transport' }));
});
