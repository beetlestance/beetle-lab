import { pendingRunHistorySummary } from '@beetle/contracts/api';
import { expect, it, vi } from 'vitest';
import type { Run, RunPage } from '@beetle/contracts/api';
import { getRun, listRuns } from '../../../src/application/runs/index.js';
import type { RunKey, RunList, RunReader } from '../../../src/ports/runs.js';
import { deferred, otherId, runValue } from './fixture.js';

const reader = (run = runValue()): RunReader => ({ getRun: async () => run,
  listRuns: async () => ({ scope: run.scope, items: [run], summaries: [pendingRunHistorySummary(run)], nextCursor: null }) });
const key = (): RunKey => ({ scope: runValue().scope, id: runValue().id });
const query = (): RunList => ({ scope: runValue().scope, limit: 1 });

it('validates exact scoped keys and strict page queries before invoking readers', async () => {
  const get = vi.fn(async () => runValue()); const list = vi.fn(reader().listRuns);
  for (const invalid of [{ ...key(), id: '../escape' }, { ...key(), extra: 1 },
    { ...key(), scope: { ...key().scope, kind: 'organization' } }]) {
    await expect(getRun(invalid as RunKey, { getRun: get, listRuns: list })).rejects.toThrow();
  }
  for (const invalid of [{ ...query(), limit: 0 }, { ...query(), limit: 101 },
    { ...query(), limit: '1' }, { ...query(), cursor: 'bad/opaque' }, { ...query(), extra: 1 }]) {
    await expect(listRuns(invalid as RunList, { getRun: get, listRuns: list })).rejects.toThrow();
  }
  expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
});

it('binds detail ID and scope and rejects inconsistent states instead of normalizing', async () => {
  const run = runValue();
  for (const changed of [{ ...run, id: otherId }, { ...run, scope: { ...run.scope, workspaceId: otherId } },
    { ...run, outcome: 'passed' }, { ...run, state: 'finished', outcome: 'passed' },
    { ...run, state: 'errored', outcome: 'inconclusive' }]) {
    await expect(getRun(key(), reader(changed as Run))).rejects.toThrow();
  }
  const finished: Run = { ...run, state: 'finished', outcome: 'inconclusive', validationStatus: 'passed' };
  expect(await getRun(key(), reader(finished))).toEqual(finished);
});

it('rejects foreign, oversized, duplicate and over-limit pages', async () => {
  const run = runValue(); const page: RunPage = { scope: run.scope, items: [run], summaries: [pendingRunHistorySummary(run)], nextCursor: null };
  for (const invalid of [{ ...page, scope: { ...page.scope, organizationId: otherId } },
    { ...page, items: [{ ...run, scope: { ...run.scope, workspaceId: otherId } }] },
    { ...page, items: [run, { ...run, id: run.id.toUpperCase() }] },
    { ...page, items: [run, { ...run, id: otherId }] },
    { ...page, items: Array.from({ length: 101 }, () => run) },
    { ...page, padding: 'x'.repeat(1048576) },
    { ...page, items: [{ ...run, padding: 'x'.repeat(65536) }] }]) {
    const list = vi.fn(async () => invalid as RunPage);
    await expect(listRuns(query(), { ...reader(), listRuns: list })).rejects.toThrow();
    expect(list).toHaveBeenCalledTimes(1);
  }
  // Duplicate UUID rejection must hold independently of the requested limit.
  const mixedCase = { ...run, id: 'a0000000-0000-4000-8000-000000000005' };
  await expect(listRuns({ ...query(), limit: 2 }, { ...reader(), listRuns: async () =>
    ({ ...page, items: [mixedCase, { ...mixedCase, id: mixedCase.id.toUpperCase() }] }) })).rejects.toThrow();
});

it('captures keys, page scope and requested limit before held reader awaits', async () => {
  const requestedKey = key(); const detail = deferred<Run>(); const source = runValue();
  const result = getRun(requestedKey, { ...reader(), getRun: () => detail.promise });
  requestedKey.id = otherId; requestedKey.scope.workspaceId = otherId;
  detail.resolve(source); const value = await result;
  source.engine.profileId = 'mutated'; expect(value.engine.profileId).toBe('k6-local');
  const requestedQuery = query(); const held = deferred<RunPage>();
  const pending = listRuns(requestedQuery, { ...reader(), listRuns: () => held.promise });
  requestedQuery.limit = 2;
  held.resolve({ scope: runValue().scope, items: [{ ...runValue(), id: otherId }, runValue()], summaries: [pendingRunHistorySummary({ ...runValue(), id: otherId }), pendingRunHistorySummary(runValue())], nextCursor: null });
  await expect(pending).rejects.toThrow();
  const scopedQuery = query(); const scopedHeld = deferred<RunPage>();
  const scopedPending = listRuns(scopedQuery, { ...reader(), listRuns: () => scopedHeld.promise });
  scopedQuery.scope.organizationId = otherId;
  scopedHeld.resolve({ scope: runValue().scope, items: [runValue()], summaries: [pendingRunHistorySummary(runValue())], nextCursor: null });
  expect((await scopedPending).items).toEqual([runValue()]);
});

it('propagates read failures without fabricating an empty page or retrying', async () => {
  const failure = new Error('unavailable'); const list = vi.fn(async () => { throw failure; });
  await expect(listRuns(query(), { ...reader(), listRuns: list })).rejects.toBe(failure);
  expect(list).toHaveBeenCalledTimes(1);
});
