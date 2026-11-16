import { expect, it, vi } from 'vitest';
import type { Run } from '@beetle/contracts/api';
import { enqueueRun } from '../../../src/application/runs/index.js';
import type { RunCommand } from '../../../src/ports/runs.js';
import { deferred, digest, operation, otherId, runValue } from './fixture.js';

it('accepts original receipt identities/time and freezes both command and reply', async () => {
  const original = runValue(); let sent!: RunCommand;
  const value = await enqueueRun({ operation: operation(), digest, store: { execute: async command => {
    sent = command; return original;
  } } });
  expect(value).toEqual(original); expect(value.id).not.toBe(sent.id);
  expect(value.activeAttemptId).not.toBe(sent.attemptId);
  expect(value.requestedAt).not.toBe(sent.requestedAt);
  expect(Object.isFrozen(sent.request.budget)).toBe(true);
  expect(Object.isFrozen(value.engine)).toBe(true);
  original.budget.cpuMillis++;
  expect(value.budget.cpuMillis).toBe(1000);
});

it('captures caller intent across a held foreign await', async () => {
  const input = operation(); const held = deferred<Run>();
  const result = enqueueRun({ operation: input, digest, store: { execute: () => held.promise } });
  input.request.budget.cpuMillis++; input.request.revisionId = otherId;
  input.request.scope.workspaceId = otherId;
  held.resolve(runValue());
  expect(await result).toEqual(runValue());
});

it('rejects every changed enqueue choice and any evolved receipt without retry', async () => {
  const run = runValue();
  const replies: Run[] = [{ ...run, revisionId: otherId },
    { ...run, engine: { ...run.engine, profileId: 'different' } },
    ...Object.keys(run.budget).map(field => ({ ...run, budget: { ...run.budget,
      [field]: run.budget[field as keyof Run['budget']] + 1 } })),
    { ...run, executionPolicy: { ...run.executionPolicy, mode: 'isolated' } },
    { ...run, executionPolicy: { ...run.executionPolicy, preferIdle: true } },
    { ...run, version: 2 }, { ...run, state: 'active' },
    { ...run, validationStatus: 'passed' }, { ...run, cancellationRequested: true },
    { ...run, reason: 'cancelled' }, { ...run, outcome: 'passed' },
    { ...run, scope: { ...run.scope, organizationId: otherId } }];
  for (const reply of replies) {
    const execute = vi.fn(async () => reply);
    await expect(enqueueRun({ operation: operation(), digest, store: { execute } })).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  }
});

it('rejects invalid or oversized commands before the digest/store and propagates uncertain failure once', async () => {
  const execute = vi.fn(async () => runValue()); const hash = vi.fn(digest);
  const invalid = operation(); invalid.request.budget.cpuMillis = 0;
  await expect(enqueueRun({ operation: invalid, digest: hash, store: { execute } })).rejects.toThrow();
  await expect(enqueueRun({ operation: { ...operation(), padding: 'x'.repeat(65536) } as ReturnType<typeof operation>,
    digest: hash, store: { execute } })).rejects.toThrow();
  expect(hash).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  const failure = new Error('unknown commit outcome'); const failed = vi.fn(async () => { throw failure; });
  await expect(enqueueRun({ operation: operation(), digest, store: { execute: failed } })).rejects.toBe(failure);
  expect(failed).toHaveBeenCalledTimes(1);
});
