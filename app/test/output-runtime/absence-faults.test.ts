import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OutputAbsenceFinalizationReply } from '../../src/ports/output-absence.js';
import { absenceFixture } from './absence-fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['proof-binding', 'proof-size', 'retained-digest', 'adopted-digest', 'adopted-proof', 'read-conflict',
  'pending', 'receipt-binding', 'receipt-digest', 'receipt-end', 'receipt-bytes', 'receipt-state',
  'snapshot-binding', 'snapshot-result', 'observation'] as const)('fences malformed absence %s without successful closure', async fault => {
  const f = absenceFixture();
  const receipt = {binding: f.binding, proofDigest: f.proofState.proofDigest, finalAgentSeq: 2,
    retainedPayloadBytes: 10, refundedBytes: 20, runVersion: 2, state: 'errored' as const, outcome: 'inconclusive' as const,
    validationStatus: 'pending' as const, reason: 'artifact_incomplete' as const};
  f.absences.finalize.mockResolvedValue({kind: 'finalized', receipt});
  const other = '00000000-0000-4000-8000-000000000099';
  const faults = {
    'proof-binding': () => Object.assign(f.proof, {journalAuthority: other}),
    'proof-size': () => Object.assign(f.proof, {padding: 'x'.repeat(2048)}),
    'retained-digest': () => f.absences.read.mockResolvedValue({...f.proofState, proofDigest: 'f'.repeat(64)}),
    'adopted-digest': () => f.absences.adopt.mockResolvedValue({...f.proofState, proofDigest: 'f'.repeat(64)}),
    'adopted-proof': () => f.absences.adopt.mockResolvedValue({...f.proofState, closure: {...f.proof, finalAgentSeq: 3}}),
    'read-conflict': () => f.absences.read.mockRejectedValue(Object.assign(new Error('Synthetic conflicting source'), {code: 'conflict'})),
    pending: () => f.absences.finalize.mockResolvedValue({kind: 'pending', reason: 'invented'} as unknown as OutputAbsenceFinalizationReply),
    'receipt-binding': () => {receipt.binding = {...f.binding, journalAuthority: other};},
    'receipt-digest': () => {receipt.proofDigest = 'f'.repeat(64);},
    'receipt-end': () => {receipt.finalAgentSeq = 3;},
    'receipt-bytes': () => {receipt.refundedBytes = Number.MAX_SAFE_INTEGER;},
    'receipt-state': () => Object.assign(receipt, {state: 'finished', outcome: 'passed'}),
    'snapshot-binding': () => {
      f.absences.finalize.mockResolvedValue({kind: 'pending', reason: 'execution'});
      Object.assign(f.snapshot, {attemptId: other});
    },
    'snapshot-result': () => {
      f.absences.finalize.mockResolvedValue({kind: 'pending', reason: 'execution'});
      Object.assign(f.snapshot, {result: {outcome: 'passed'}});
    },
    observation: () => {
      f.absences.finalize.mockResolvedValue({kind: 'pending', reason: 'execution'});
      f.observations.observe.mockResolvedValue({} as never);
    },
  };
  faults[fault](); f.scheduler.start(); await vi.advanceTimersByTimeAsync(100);
  expect(f.scheduler.state().status).toBe('failed'); expect(f.options.onFailure).toHaveBeenCalledOnce();
  await expect(f.scheduler.close()).rejects.toThrow(); f.dispose();
});
it('keeps proof transport failure visible and does not adopt or finalize', async () => {
  const f = absenceFixture(); const absent = vi.mocked(f.options.gateway.output);
  absent.mockImplementation(() => ({absence: async () => ({ok: false, error: {kind: 'transport'}}), source: vi.fn(), sourceChunk: vi.fn()}));
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(100);
  expect(f.scheduler.state()).toMatchObject({status: 'running', problem: 'transport'});
  expect(f.absences.adopt).not.toHaveBeenCalled(); expect(f.absences.finalize).not.toHaveBeenCalled();
  await f.scheduler.close(); f.dispose();
});
it('defers only finalization version conflicts and retains proof without refetch on the next pass', async () => {
  const f = absenceFixture();
  f.absences.finalize.mockRejectedValueOnce(Object.assign(new Error('Synthetic version race'), {code: 'conflict'}));
  f.absences.read.mockResolvedValue(f.proofState);
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(100);
  expect(f.scheduler.state().status).toBe('running'); expect(f.options.onFailure).not.toHaveBeenCalled();
  expect(f.absences.finalize.mock.calls.length).toBeGreaterThan(1); expect(f.absence).not.toHaveBeenCalled();
  await f.scheduler.close(); f.dispose();
});
