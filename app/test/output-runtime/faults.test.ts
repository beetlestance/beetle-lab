import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OutputFinalizationReply } from '../../src/ports/output-finalization.js';
import type { OutputTransferOutcome } from '../../src/ports/output-transfer.js';
import { fixture, held, published } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['transfer-binding', 'transfer-digest', 'receipt-binding', 'receipt-digest', 'receipt-bound', 'receipt-extra',
  'receipt-projection', 'pending', 'scan', 'run'] as const)('fails closed for malformed positive %s', async fault => {
  const f = fixture(); const binding = f.bindings[0]!;
  const reply = {kind: 'finalized' as const, receipt: {binding, sourceDigest: 'c'.repeat(64), manifestDigest: 'b'.repeat(64),
    finalAgentSeq: 0, retainedPayloadBytes: 10, refundedBytes: 20, runVersion: 2,
    state: 'finished' as const, outcome: 'passed' as const, validationStatus: 'passed' as const, reason: null}};
  const outcome = published(binding);
  f.transfers.transfer.mockImplementation(() => ({result: Promise.resolve(outcome), settled: Promise.resolve()}));
  f.finalize.mockResolvedValue(reply);
  const original = f.getRun.getMockImplementation()!;
  const faults = {
    'transfer-binding': () => Object.assign(outcome, {binding: {...binding, journalAuthority: '00000000-0000-4000-8000-000000000099'}}),
    'transfer-digest': () => Object.assign(outcome, {sourceDigest: 'invalid'}),
    'receipt-binding': () => {reply.receipt.binding = {...binding, journalAuthority: '00000000-0000-4000-8000-000000000099'};},
    'receipt-digest': () => {reply.receipt.sourceDigest = 'd'.repeat(64);},
    'receipt-bound': () => {reply.receipt.refundedBytes = Number.MAX_SAFE_INTEGER;},
    'receipt-extra': () => Object.assign(reply.receipt, {extra: 'forbidden'}),
    'receipt-projection': () => Object.assign(reply.receipt, {outcome: 'pending'}),
    pending: () => f.finalize.mockResolvedValue({kind: 'pending', reason: 'invented'} as unknown as OutputFinalizationReply),
    scan: () => f.outputs.scan.mockResolvedValue({items: [], nextCursor: 'impossible'}),
    run: () => f.getRun.mockImplementation(async key => ({...await original(key), activeAttemptId: '00000000-0000-4000-8000-000000000099'})),
  };
  faults[fault]();
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(100);
  expect(f.scheduler.state().status).toBe('failed'); expect(f.options.onFailure).toHaveBeenCalledTimes(1);
  await expect(f.scheduler.close()).rejects.toThrow(); f.dispose();
});
it('accepts a bounded exact terminal receipt without projecting a Run itself', async () => {
  const f = fixture(); f.transfers.transfer.mockImplementation(binding => ({result: Promise.resolve(published(binding)), settled: Promise.resolve()}));
  f.finalize.mockImplementation(async request => ({kind: 'finalized', receipt: {binding: request.binding,
    sourceDigest: request.sourceDigest, manifestDigest: request.manifestDigest, finalAgentSeq: 0,
    retainedPayloadBytes: 10, refundedBytes: 20, runVersion: 2, state: 'finished', outcome: 'failed', validationStatus: 'passed', reason: null}}));
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(100);
  expect(f.scheduler.state().status).toBe('running'); expect(f.finalize).toHaveBeenCalled();
  await f.scheduler.close(); f.dispose();
});
it('retains result and settlement independently on close and aborts the issued hint synchronously', async () => {
  const f = fixture(); const job = held(); f.transfers.transfer.mockReturnValue({result: job.result.promise, settled: job.settled.promise});
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(0); const closing = f.scheduler.close();
  expect(f.transfers.transfer.mock.calls[0]![1]!.aborted).toBe(true);
  job.settled.resolve(); await vi.advanceTimersByTimeAsync(100); expect(f.files.close).not.toHaveBeenCalled();
  job.result.resolve({kind: 'pending'}); await closing; expect(f.files.close).toHaveBeenCalledTimes(1); f.dispose();
});
it('reports a negative result immediately while retaining the unsettled original, slot and lease', async () => {
  const f = fixture(2); const job = held(); f.transfers.transfer.mockReturnValue({result: job.result.promise, settled: job.settled.promise});
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(0); job.result.reject(new Error('Synthetic integrity failure'));
  await vi.advanceTimersByTimeAsync(100);
  expect(f.scheduler.state()).toEqual({status: 'failed', active: 1, problem: 'operation_failure'});
  expect(f.options.onFailure).toHaveBeenCalledTimes(1); expect(f.transfers.transfer).toHaveBeenCalledTimes(1);
  const closing = f.scheduler.close(); const observed = expect(closing).rejects.toThrow('Synthetic integrity failure');
  await vi.advanceTimersByTimeAsync(100); expect(f.files.close).not.toHaveBeenCalled();
  job.settled.resolve(); await observed; expect(f.files.close).toHaveBeenCalledTimes(1); f.dispose();
});
it('keeps callback failure explicit and caches failed native close', async () => {
  const f = fixture(); f.files.close.mockRejectedValue(new Error('Synthetic retained native close'));
  vi.mocked(f.options.onFailure).mockRejectedValue(new Error('Synthetic notification failure'));
  const closing = f.scheduler.close(); await expect(closing).rejects.toBeInstanceOf(AggregateError);
  expect(f.scheduler.close()).toBe(closing); expect(f.scheduler.state().problem).toBe('failure_notification');
  expect(f.files.close).toHaveBeenCalledTimes(1); expect(f.options.onFailure).toHaveBeenCalledTimes(1); f.dispose();
});
it('rejects accessor transfer positives without invoking the accessor', async () => {
  const f = fixture(); const getter = vi.fn(() => 'pending');
  f.transfers.transfer.mockReturnValue({result: Promise.resolve(Object.defineProperty({}, 'kind', {get: getter}) as OutputTransferOutcome), settled: Promise.resolve()});
  f.scheduler.start(); await vi.advanceTimersByTimeAsync(0); expect(getter).not.toHaveBeenCalled();
  await expect(f.scheduler.close()).rejects.toThrow(); f.dispose();
});
