import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '../../../src/api/index.js';
import type { Run } from '../../../src/api/index.js';
import { baseUrl, load, otherId, params, reply } from './helpers.js';

it('rejects enqueue fields that could select arbitrary runtime inputs before fetch', async () => {
  const body = await load('create-run', 'CreateRunRequest');
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher });
  for (const extra of [{ config: {} }, { imageDigest: `sha256:${'f'.repeat(64)}` },
    { secretValues: { token: 'synthetic' } }, { mount: '/tmp/synthetic' }]) {
    expect(await client.createRun({ params, body: { ...body, ...extra } }))
      .toEqual({ ok: false, error: { kind: 'request' } });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('binds accepted enqueue to the exact revision/profile/budget/policy and original queued snapshot', async () => {
  const body = await load('create-run', 'CreateRunRequest'); const run = await load('run', 'Run');
  expect(await createApiClient({ baseUrl, fetch: reply(run, 202) }).createRun({ params, body }))
    .toEqual({ ok: true, value: run });
  const mismatches: Run[] = [{ ...run, revisionId: otherId },
    { ...run, engine: { ...run.engine, profileId: 'different-profile' } },
    { ...run, budget: { ...run.budget, cpuMillis: run.budget.cpuMillis + 1 } },
    { ...run, executionPolicy: { ...run.executionPolicy, preferIdle: true } },
    { ...run, executionPolicy: { ...run.executionPolicy, mode: 'isolated' } },
    { ...run, version: 2 }, { ...run, state: 'active' }];
  for (const value of mismatches) {
    expect(validateApi('Run', value).ok).toBe(true);
    expect(await createApiClient({ baseUrl, fetch: reply(value, 202) }).createRun({ params, body }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('rejects wrong detail IDs and cross-workspace page items', async () => {
  const run = await load('run', 'Run');
  expect(await createApiClient({ baseUrl, fetch: reply({ ...run, id: otherId }) }).getRun({
    params: { ...params, runId: run.id },
  })).toEqual({ ok: false, error: { kind: 'response' } });
  const page = await load('run-page', 'RunPage'); page.items[0]!.scope.workspaceId = otherId;
  expect(await createApiClient({ baseUrl, fetch: reply(page) }).listRuns({ params, query: { limit: 10 } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});

it('does not accept a queued pass or an execution error reported as a test pass', async () => {
  const run = await load('run', 'Run');
  for (const value of [{ ...run, outcome: 'passed' }, { ...run, state: 'errored', outcome: 'passed' },
    { ...run, state: 'finished', outcome: 'passed', validationStatus: 'pending' }]) {
    expect(validateApi('Run', value).ok).toBe(true);
    expect(await createApiClient({ baseUrl, fetch: reply(value) }).getRun({ params: { ...params, runId: run.id } }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('bounds run pages and request policy without coercion or default insertion', async () => {
  const page = await load('run-page', 'RunPage');
  expect(validateApi('RunPage', { ...page, items: Array.from({ length: 101 }, () => page.items[0]) }).ok).toBe(false);
  const body = await load('create-run', 'CreateRunRequest');
  for (const executionPolicy of [{ mode: 'parallel' }, { mode: 'auto', preferIdle: false },
    { mode: 'parallel', preferIdle: 'false' }]) {
    const original = structuredClone(executionPolicy);
    expect(validateApi('CreateRunRequest', { ...body, executionPolicy }).ok).toBe(false);
    expect(executionPolicy).toEqual(original);
  }
});
