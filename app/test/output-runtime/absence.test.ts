import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OutputAbsenceFinalizationReply, OutputAbsenceState } from '../../src/ports/output-absence.js';
import { OutputTransferError } from '../../src/ports/output-transfer.js';
import { absenceFixture } from './absence-fixture.js';
import { deferred, held, published } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

it.each(['result-first', 'settled-first'] as const)('waits for both transfer originals before any proof operation: %s', async order => {
  const f = absenceFixture(); const job = held();
  f.transfers.transfer.mockReturnValueOnce({result: job.result.promise, settled: job.settled.promise});
  f.scheduler.start(); await tick();
  if (order === 'result-first') job.result.reject(new OutputTransferError('source_absent')); else job.settled.resolve();
  await tick(100); expect(f.scheduler.state().active).toBe(1);
  expect(f.absences.read).not.toHaveBeenCalled(); expect(f.absence).not.toHaveBeenCalled();
  expect(f.absences.adopt).not.toHaveBeenCalled(); expect(f.absences.finalize).not.toHaveBeenCalled();
  if (order === 'result-first') job.settled.resolve(); else job.result.reject(new OutputTransferError('source_absent'));
  await tick(); expect(f.absences.finalize).toHaveBeenCalledOnce();
  expect(f.absence).toHaveBeenCalledOnce(); expect(f.absences.adopt).toHaveBeenCalledWith({binding: f.binding, closure: f.proof});
  await f.scheduler.close(); f.dispose();
});
it('never reads absence custody for a source-present transfer or a pending source', async () => {
  const f = absenceFixture();
  f.transfers.transfer.mockImplementationOnce(() => ({result: Promise.resolve(published(f.binding)), settled: Promise.resolve()}))
    .mockImplementation(() => ({result: Promise.resolve({kind: 'pending'}), settled: Promise.resolve()}));
  f.scheduler.start(); await tick(150);
  expect(f.finalize).toHaveBeenCalledOnce(); expect(f.absences.read).not.toHaveBeenCalled(); expect(f.absence).not.toHaveBeenCalled();
  await f.scheduler.close(); f.dispose();
});
it('uses retained proof after handoff without remote refetch/adoption', async () => {
  const f = absenceFixture(); f.absences.read.mockResolvedValue(f.proofState);
  f.scheduler.start(); await tick();
  expect(f.absences.finalize).toHaveBeenCalledOnce(); expect(f.absence).not.toHaveBeenCalled(); expect(f.absences.adopt).not.toHaveBeenCalled();
  await f.scheduler.close(); f.dispose();
});
it('refreshes the full bound snapshot once per pass, observes it, rereads Run, then retries the exact proof with a fresh version', async () => {
  const f = absenceFixture();
  f.absences.finalize.mockResolvedValue({kind: 'pending', reason: 'execution'});
  const original = f.getRun.getMockImplementation()!;
  let version = 1; f.getRun.mockImplementation(async key => ({...await original(key), version}));
  const observe = f.observations.observe.getMockImplementation()!;
  f.observations.observe.mockImplementation(async request => {version = 2; return observe(request);});
  f.scheduler.start(); await tick();
  expect(f.absences.finalize.mock.calls.map(([request]) => request.expectedRunVersion)).toEqual([1, 2]);
  expect(f.snapshotCall).toHaveBeenCalledOnce(); expect(f.options.gateway.attempt).toHaveBeenCalledWith({
    ...f.binding.key.attempt, journalAuthority: f.binding.journalAuthority});
  expect(f.observations.observe).toHaveBeenCalledWith({key: f.binding.key, journalAuthority: f.binding.journalAuthority, snapshot: f.snapshot});
  expect(f.absences.finalize.mock.calls.map(([request]) => request.proofDigest)).toEqual([f.proofState.proofDigest, f.proofState.proofDigest]);
  await f.scheduler.close(); f.dispose();
});
it.each(['read', 'proof', 'adopt', 'run', 'finalize', 'snapshot', 'observe', 'retry'] as const)(
  'retains held %s original and native lease through close; fences later calls', async phase => {
    const f = absenceFixture(); const heldRead = deferred<OutputAbsenceState | null>();
    const heldProof = deferred<Awaited<ReturnType<typeof f.absence>>>();
    const heldAdopt = deferred<OutputAbsenceState>(); const heldFinal = deferred<OutputAbsenceFinalizationReply>();
    const heldSnapshot = deferred<Awaited<ReturnType<typeof f.snapshotCall>>>();
    const heldObserve = deferred<Awaited<ReturnType<typeof f.observations.observe>>>();
    const heldRun = deferred<Awaited<ReturnType<typeof f.getRun>>>();
    const originalRun = f.getRun.getMockImplementation()!;
    const current = await originalRun({id: f.binding.key.runId, scope: {kind: 'workspace',
      organizationId: f.binding.key.attempt.organizationId, workspaceId: f.binding.key.attempt.workspaceId}});
    if (phase === 'read') f.absences.read.mockReturnValueOnce(heldRead.promise);
    if (phase === 'proof') f.absence.mockReturnValueOnce(heldProof.promise);
    if (phase === 'adopt') f.absences.adopt.mockReturnValueOnce(heldAdopt.promise);
    if (phase === 'run') f.getRun.mockReturnValueOnce(heldRun.promise);
    if (phase === 'finalize') f.absences.finalize.mockReturnValueOnce(heldFinal.promise);
    if (['snapshot', 'observe', 'retry'].includes(phase)) f.absences.finalize.mockResolvedValueOnce({kind: 'pending', reason: 'execution'});
    if (phase === 'snapshot') f.snapshotCall.mockReturnValueOnce(heldSnapshot.promise);
    if (phase === 'observe') f.observations.observe.mockReturnValueOnce(heldObserve.promise);
    if (phase === 'retry') f.absences.finalize.mockReset().mockResolvedValueOnce({kind: 'pending', reason: 'execution'}).mockReturnValueOnce(heldFinal.promise);
    f.scheduler.start(); await tick(); const closing = f.scheduler.close();
    await tick(100); expect(f.scheduler.state().active).toBe(1); expect(f.files.close).not.toHaveBeenCalled();
    const before = [f.absences.adopt.mock.calls.length, f.absences.finalize.mock.calls.length, f.snapshotCall.mock.calls.length,
      f.observations.observe.mock.calls.length, f.getRun.mock.calls.length];
    heldRead.resolve(null); heldProof.resolve({ok: true, value: f.proof}); heldAdopt.resolve(f.proofState);
    heldRun.resolve(current); heldSnapshot.resolve({ok: true, value: f.snapshot});
    heldObserve.resolve({run: current, snapshot: f.snapshot, executionCharged: false, runChanged: false});
    heldFinal.resolve({kind: 'pending', reason: 'events'}); await closing;
    expect([f.absences.adopt.mock.calls.length, f.absences.finalize.mock.calls.length, f.snapshotCall.mock.calls.length,
      f.observations.observe.mock.calls.length, f.getRun.mock.calls.length]).toEqual(before);
    expect(f.files.close).toHaveBeenCalledOnce(); f.dispose();
  });
it('holds only two absence originals and retains both through close', async () => {
  const f = absenceFixture(3); const reads = [deferred<OutputAbsenceState | null>(), deferred<OutputAbsenceState | null>()];
  f.absences.read.mockReturnValueOnce(reads[0]!.promise).mockReturnValueOnce(reads[1]!.promise);
  f.scheduler.start(); await tick(200); expect(f.scheduler.state().active).toBe(2); expect(f.absences.read).toHaveBeenCalledTimes(2);
  const closing = f.scheduler.close(); reads[0]!.resolve(null); await tick(); expect(f.files.close).not.toHaveBeenCalled();
  reads[1]!.resolve(null); await closing; f.dispose();
});
