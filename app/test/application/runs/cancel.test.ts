import { expect, it, vi } from 'vitest';
import { cancelRun } from '../../../src/application/runs/index.js';
import type { CancelRunOperation, RunCancellationStore } from '../../../src/ports/runs.js';
import { deferred, digest, otherId, runValue } from './fixture.js';

function operation(): CancelRunOperation {
  const run = runValue();
  return { kind: 'cancelRun', id: run.id, request: { scope: run.scope, requestId: otherId } };
}

it('captures intent before await and returns an immutable stopping receipt', async () => {
  const held = deferred<ReturnType<typeof runValue>>(); const original = operation();
  const cancel = vi.fn<RunCancellationStore['cancel']>(() => held.promise);
  const pending = cancelRun({ operation: original, digest, store: { cancel } });
  original.id = otherId; original.request.scope.workspaceId = otherId;
  const accepted = { ...runValue(), version: 2, cancellationRequested: true };
  held.resolve(accepted);
  const result = await pending;
  expect(result).toEqual(accepted); expect(result.state).toBe('queued');
  expect(Object.isFrozen(result)).toBe(true); expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel.mock.calls[0]![0].id).toBe(accepted.id);
});

it('rejects wrong scope, wrong run and a nonterminal receipt without intent', async () => {
  const accepted = { ...runValue(), cancellationRequested: true };
  for (const result of [runValue(), { ...accepted, id: otherId },
    { ...accepted, scope: { ...accepted.scope, workspaceId: otherId } }]) {
    const cancel = vi.fn<RunCancellationStore['cancel']>(async () => result);
    await expect(cancelRun({ operation: operation(), digest, store: { cancel } })).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  }
});

it('preserves prior terminal outcomes without inventing cancellation or retrying failures', async () => {
  const finished = { ...runValue(), state: 'finished' as const, outcome: 'passed' as const,
    validationStatus: 'passed' as const };
  expect(await cancelRun({ operation: operation(), digest, store: { cancel: async () => finished } })).toEqual(finished);
  const failure = new Error('synthetic unavailable');
  const cancel = vi.fn<RunCancellationStore['cancel']>(async () => { throw failure; });
  await expect(cancelRun({ operation: operation(), digest, store: { cancel } })).rejects.toBe(failure);
  expect(cancel).toHaveBeenCalledTimes(1);
});
