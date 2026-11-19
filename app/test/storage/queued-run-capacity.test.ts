import { expect, it, vi } from 'vitest';
import { observation, scope, seed, settingsFixture, storageFixture } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runCommand, runOptions, runRequest } from './runs-fixture.js';
import { claimsFixture } from './dispatch-claim-fixtures.js';
const fixture = storageFixture();
function live() {
  const ceilings = settingsFixture().runtime;
  ceilings.pool.storageBytes = 10_000_000;
  return ceilings;
}
it('durably queues with unknown capacity, preserves receipt replay, then becomes dispatchable after a fresh reading', async () => {
  const metadata = await fixture.open(undefined, runOptions());
  await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const command = runCommand(revision.id);
  await metadata.updateRuntime(null);
  const queued = await metadata.runs.execute(command);
  expect(queued.state).toBe('queued');
  expect(await metadata.installationStatus.runQueue({ scope, id: queued.id })).toMatchObject({
    waiting: 'backend_queue',
    capacityBlockReason: 'capacity_unknown',
  });
  expect(await metadata.runs.execute(command)).toEqual(queued);
  const blocked = await metadata.dispatch.scan({ lane: 'queued', limit: 1 });
  expect(blocked.items[0]?.eligibility).toEqual({ kind: 'blocked', reason: 'capacity_unknown' });
  expect((await metadata.runs.getRun({ scope, id: queued.id })).state).toBe('queued');
  await metadata.updateRuntime(observation(live()));
  expect((await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]?.eligibility).toEqual({ kind: 'ready' });
  expect(await metadata.installationStatus.runQueue({ scope, id: queued.id })).toMatchObject({
    capacityBlockReason: null,
  });
});
it('keeps a valid installed budget queued when live limits shrink, and refuses budgets outside installed policy', async () => {
  const metadata = await fixture.open(undefined, runOptions());
  await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const ceilings = live();
  ceilings.perRun.memoryBytes = 50;
  await metadata.updateRuntime(observation(ceilings));
  const queued = await metadata.runs.execute(runCommand(revision.id));
  expect(queued.budget.memoryBytes).toBe(100);
  expect(await metadata.installationStatus.runQueue({ scope, id: queued.id })).toMatchObject({
    capacityBlockReason: 'per_run_ceiling',
  });
  expect((await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]?.eligibility).toEqual({
    kind: 'blocked',
    reason: 'per_run_ceiling',
  });
  const request = runRequest(revision.id);
  request.budget.memoryBytes = 1001;
  await expect(metadata.runs.execute(runCommand(revision.id, 72, request))).rejects.toMatchObject({
    code: 'invalid_value',
  });
  expect((await metadata.runs.listRuns({ scope, limit: 100 })).items).toHaveLength(1);
});
it('enforces the finite enqueue bound even when no live reading exists', async () => {
  const metadata = await fixture.open(undefined, runOptions(1));
  await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  await metadata.updateRuntime(null);
  await metadata.runs.execute(runCommand(revision.id));
  await expect(metadata.runs.execute(runCommand(revision.id, 72))).rejects.toMatchObject({ code: 'queue_full' });
});

it('queues after the last observation actually expires, without refreshing or retrying creation', () => {
  vi.useFakeTimers();
  const f = claimsFixture(4_000_000);
  try {
    vi.advanceTimersByTime(5001);
    const key = f.add();
    expect(f.claims.scan({ lane: 'queued', limit: 1 }).items[0]).toMatchObject({
      key,
      eligibility: { kind: 'blocked', reason: 'capacity_unknown' },
    });
  } finally {
    f.db.close();
    vi.useRealTimers();
  }
});
