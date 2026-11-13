import { expect, it } from 'vitest';
import { createRunnerClient } from '../../src/generated/client.js';
import type { RunnerTransport } from '../../src/http.js';
import { captureOutputAbsence, OUTPUT_ABSENCE_BYTES, OUTPUT_REJECTION_REASONS } from '../../src/output-source/index.js';
import { encodeCanonicalJson, validate } from '../../src/index.js';

function proof() {
  return { version: 1, organizationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    generation: 1, intentDigest: 'd'.repeat(64), journalAuthority: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    finalAgentSeq: 2, admission: { state: 'rejected', reason: 'unsupported_capability' }, reason: 'unsupported_capability' };
}
it('captures closed definitive facts under a byte cap without creating source or outcome authority', () => {
  const input = proof(); const value = captureOutputAbsence(input, { ...input, generation: 1 });
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.admission)).toBe(true);
  input.admission.reason = 'cancelled'; expect(value.admission).toEqual({ state: 'rejected', reason: 'unsupported_capability' });
  expect(Buffer.byteLength(encodeCanonicalJson(value, OUTPUT_ABSENCE_BYTES))).toBeLessThanOrEqual(OUTPUT_ABSENCE_BYTES);
  expect(value).not.toHaveProperty('result'); expect(value).not.toHaveProperty('receipt');
});
it.each(Object.entries(OUTPUT_REJECTION_REASONS))('enforces the single rejection mapping for %s', (reason, mapped) => {
  expect(captureOutputAbsence({ ...proof(), admission: { state: 'rejected', reason }, reason: mapped }).reason).toBe(mapped);
  expect(() => captureOutputAbsence({ ...proof(), admission: { state: 'rejected', reason },
    reason: mapped === 'setup_failed' ? 'artifact_incomplete' : 'setup_failed' })).toThrow();
});
it('preserves a durable clock-integrity reason in a never-started closure', () => {
  const value = captureOutputAbsence({ ...proof(), admission: { state: 'released', disposition: 'never_started' }, reason: 'clock_integrity' });
  expect(value.reason).toBe('clock_integrity');
  expect(value.admission).toEqual({ state: 'released', disposition: 'never_started' });
});
it.each(['never_started', 'settled'])('accepts released %s facts without synthesizing a source', disposition => {
  expect(captureOutputAbsence({ ...proof(), admission: { state: 'released', disposition }, reason: 'artifact_incomplete' })
    .admission).toEqual({ state: 'released', disposition });
});
it.each([{ admission: { state: 'queued' } }, { admission: { state: 'charged' } }, { generation: 2 },
  { finalAgentSeq: -1 }, { finalAgentSeq: Number.MAX_SAFE_INTEGER + 1 }, { result: {} }, { receipt: {} },
  { reason: 'passed' }, { padding: 'x'.repeat(OUTPUT_ABSENCE_BYTES) }])('rejects malformed or non-definitive closure %#', patch => {
  expect(() => captureOutputAbsence({ ...proof(), ...patch })).toThrow();
});
it.each(['organizationId', 'workspaceId', 'attemptId', 'intentDigest', 'journalAuthority'] as const)(
  'rejects a mismatched original %s', key => {
    const original = { ...proof(), generation: 1 as const };
    expect(() => captureOutputAbsence(proof(), { ...original,
      [key]: key === 'intentDigest' ? 'f'.repeat(64) : 'ffffffff-ffff-4fff-8fff-ffffffffffff' })).toThrow();
  });
it('rejects accessors before invoking them and preserves exact physical Journal spelling', () => {
  let called = false; const input = proof();
  Object.defineProperty(input, 'reason', { enumerable: true, get() { called = true; throw new Error('Synthetic getter'); } });
  expect(() => captureOutputAbsence(input)).toThrow(); expect(called).toBe(false);
  const upper = { ...proof(), journalAuthority: proof().journalAuthority.toUpperCase() };
  expect(captureOutputAbsence(upper).journalAuthority).toBe(upper.journalAuthority);
  expect(() => captureOutputAbsence(upper, { ...proof(), generation: 1 })).toThrow();
});
it('generates only a read operation and keeps its marker separate from closure diagnostics', async () => {
  const calls: unknown[] = [];
  const transport: RunnerTransport = { json: async input => { calls.push(input); return { ok: false, error: { kind: 'transport' } }; } };
  await createRunnerClient(transport).outputAbsence(proof().attemptId);
  expect(calls).toMatchObject([{ method: 'GET', path: `/runner/v1/attempts/${proof().attemptId}/source/absence`,
    response: 'OutputAbsence', successStatus: 200 }]);
  expect(validate('ProtocolError', { protocolVersion: '1.0', organizationId: proof().organizationId,
    workspaceId: proof().workspaceId, attemptId: proof().attemptId,
    reason: 'source_absent', retry: 'never', issues: [] }).ok).toBe(true);
  expect(validate('ProtocolError', { protocolVersion: '1.0', organizationId: proof().organizationId,
    workspaceId: proof().workspaceId,
    reason: 'source_absent', retry: 'never', issues: [] }).ok).toBe(false);
  expect(validate('ProtocolError', { protocolVersion: '1.0', organizationId: proof().organizationId,
    workspaceId: proof().workspaceId, attemptId: proof().attemptId,
    reason: 'source_absent', retry: 'transport', issues: [] }).ok).toBe(false);
  expect(() => captureOutputAbsence({ ...proof(), admission: { state: 'released', disposition: 'never_started' },
    reason: 'source_absent' })).toThrow();
});
