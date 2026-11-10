import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OutputTransferError } from '../../src/ports/output-transfer.js';
import { fixture, held, published, deferred } from './fixture.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
async function tick(ms = 0) { await vi.advanceTimersByTimeAsync(ms); }

it('holds two exact originals, advances past active bindings and reaches later candidates fairly', async () => {
  const f = fixture(4); const first = held(); const second = held();
  f.transfers.transfer.mockImplementationOnce(() => ({result: first.result.promise, settled: first.settled.promise}))
    .mockImplementationOnce(() => ({result: second.result.promise, settled: second.settled.promise}));
  f.scheduler.start();
  try {
    await tick(); expect(f.transfers.transfer).toHaveBeenCalledTimes(1);
    await tick(24); expect(f.transfers.transfer).toHaveBeenCalledTimes(1);
    await tick(1); expect(f.scheduler.state().active).toBe(2);
    first.result.resolve({kind: 'pending'}); await tick(100);
    expect(f.transfers.transfer).toHaveBeenCalledTimes(2);
    first.settled.resolve(); await tick(25);
    expect(f.transfers.transfer.mock.calls[2]![0]).toEqual(f.bindings[2]);
    await tick(25); expect(f.transfers.transfer.mock.calls[3]![0]).toEqual(f.bindings[3]);
    second.result.resolve({kind: 'pending'}); second.settled.resolve(); await tick(100);
    expect(f.scans).toContain('4'); expect(f.scheduler.state().active).toBeLessThanOrEqual(2);
  } finally {first.result.resolve({kind: 'pending'}); first.settled.resolve(); second.result.resolve({kind: 'pending'});
    second.settled.resolve(); await f.scheduler.close(); f.dispose();}
});
it('skips an active binding on the next finite pass without starving later candidates', async () => {
  const f = fixture(3); const job = held();
  f.transfers.transfer.mockImplementationOnce(() => ({result: job.result.promise, settled: job.settled.promise}));
  f.scheduler.start(); await tick(250);
  const calls = f.transfers.transfer.mock.calls.map(([binding]) => binding.key.attempt.attemptId);
  expect(calls.filter(id => id === f.bindings[0]!.key.attempt.attemptId)).toHaveLength(1);
  expect(calls.filter(id => id === f.bindings[1]!.key.attempt.attemptId).length).toBeGreaterThan(1);
  expect(calls.filter(id => id === f.bindings[2]!.key.attempt.attemptId).length).toBeGreaterThan(1);
  expect(f.scans).toContain(undefined); expect(f.scheduler.state().active).toBe(1);
  job.result.resolve({kind: 'pending'}); job.settled.resolve(); await f.scheduler.close(); f.dispose();
});
it('advances unbound diagnostics without inventing a binding or issuing a transfer', async () => {
  const f = fixture();
  const original = f.outputs.scan.getMockImplementation()!;
  f.outputs.scan.mockImplementationOnce(async query => {
    const page = await original(query);
    return {items: page.items.map(item => ({kind: 'unbound', key: item.kind === 'ready' ? item.binding.key : item.key,
      order: item.order, after: item.after})), nextCursor: '1'};
  });
  f.scheduler.start(); await tick(); expect(f.transfers.transfer).not.toHaveBeenCalled();
  await tick(25); expect(f.scans).toEqual([undefined, '1']); expect(f.scheduler.state().status).toBe('running');
  await f.scheduler.close(); f.dispose();
});
it('does not read or finalize before transfer settlement and retries pending and version conflict on later finite passes', async () => {
  const f = fixture(); const original = held();
  f.transfers.transfer.mockImplementationOnce(() => ({result: original.result.promise, settled: original.settled.promise}))
    .mockImplementation(binding => ({result: Promise.resolve(published(binding)), settled: Promise.resolve()}));
  f.scheduler.start();
  try {
    await tick(); original.result.resolve(published(f.bindings[0]!)); await tick(100);
    expect(f.getRun).not.toHaveBeenCalled(); expect(f.scheduler.state().active).toBe(1);
    original.settled.resolve(); await tick(); expect(f.finalize).toHaveBeenCalledTimes(1);
    expect(f.finalize.mock.calls[0]![0]).toMatchObject({expectedRunVersion: 1, binding: f.bindings[0]});
    f.finalize.mockRejectedValueOnce(Object.assign(new Error('Synthetic version race'), {code: 'conflict'}));
    await tick(100); expect(f.finalize.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(f.scheduler.state().status).toBe('running'); expect(f.options.onFailure).not.toHaveBeenCalled();
  } finally {await f.scheduler.close(); f.dispose();}
});
it.each(['transport', 'source_unavailable'] as const)('retains visible %s retry state and retries only after originals settle', async code => {
  const f = fixture(); const original = held();
  f.transfers.transfer.mockImplementationOnce(() => ({result: original.result.promise, settled: original.settled.promise}));
  f.scheduler.start();
  try {
    await tick(); original.result.reject(new OutputTransferError(code)); await tick(100);
    expect(f.scheduler.state()).toEqual({status: 'running', active: 1, problem: code});
    expect(f.transfers.transfer).toHaveBeenCalledTimes(1); original.settled.resolve(); await tick(100);
    expect(f.transfers.transfer.mock.calls.length).toBeGreaterThan(1); expect(f.options.onFailure).not.toHaveBeenCalled();
  } finally {original.settled.resolve(); await f.scheduler.close(); f.dispose();}
});
it.each(['integrity', 'cleanup', 'storage', 'invalid_input', 'conflict'] as const)('fences fatal %s immediately and notifies once', async code => {
  const f = fixture(2); f.transfers.transfer.mockImplementation(() => ({result: Promise.reject(new OutputTransferError(code)), settled: Promise.resolve()}));
  f.scheduler.start(); await tick(200);
  expect(f.scheduler.state()).toEqual({status: 'failed', active: 0, problem: 'operation_failure'});
  expect(f.options.onFailure).toHaveBeenCalledTimes(1); expect(f.transfers.transfer).toHaveBeenCalledTimes(1);
  await expect(f.scheduler.close()).rejects.toMatchObject({code}); expect(f.files.close).toHaveBeenCalledTimes(1); f.dispose();
});
it('defers local busy without failing', async () => {
  const f = fixture(); f.transfers.transfer.mockImplementationOnce(() => ({result: Promise.reject(new OutputTransferError('busy')), settled: Promise.resolve()}));
  f.scheduler.start(); await tick(100); expect(f.scheduler.state().status).toBe('running');
  expect(f.transfers.transfer.mock.calls.length).toBeGreaterThan(1); await f.scheduler.close(); f.dispose();
});
it('retains a scanner original and admits nothing after close', async () => {
  const f = fixture(); const scan = deferred<Awaited<ReturnType<typeof f.outputs.scan>>>(); f.outputs.scan.mockReturnValueOnce(scan.promise);
  f.scheduler.start(); await tick(); const closing = f.scheduler.close(); let closed = false; void closing.then(() => {closed = true;});
  await tick(100); expect(closed).toBe(false); expect(f.files.close).not.toHaveBeenCalled();
  scan.resolve({items: [], nextCursor: null}); await closing;
  expect(f.transfers.transfer).not.toHaveBeenCalled(); expect(f.scheduler.close()).toBe(closing); f.dispose();
});
it.each(['run', 'finalize'] as const)('retains a late %s original until close drains it', async phase => {
  const f = fixture(); const run = deferred<Awaited<ReturnType<typeof f.getRun>>>(); const final = deferred<Awaited<ReturnType<typeof f.finalize>>>();
  f.transfers.transfer.mockImplementation(binding => ({result: Promise.resolve(published(binding)), settled: Promise.resolve()}));
  const attempt = f.bindings[0]!.key.attempt;
  const current = await f.getRun({id: f.bindings[0]!.key.runId, scope: {kind: 'workspace',
    organizationId: attempt.organizationId, workspaceId: attempt.workspaceId}});
  if (phase === 'run') f.getRun.mockReturnValueOnce(run.promise); else f.finalize.mockReturnValueOnce(final.promise);
  f.scheduler.start(); await tick(); const closing = f.scheduler.close();
  expect(f.scheduler.state().status).toBe('closed'); expect(f.files.close).not.toHaveBeenCalled();
  await tick(100); expect(f.files.close).not.toHaveBeenCalled();
  run.resolve(current); final.resolve({kind: 'pending', reason: 'events'}); await closing;
  if (phase === 'run') expect(f.finalize).not.toHaveBeenCalled(); expect(f.files.close).toHaveBeenCalledTimes(1); f.dispose();
});
