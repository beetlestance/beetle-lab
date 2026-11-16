import { expect, it } from 'vitest';
import { createApiClient } from '../../../src/api/index.js';
import type { CancelRunRequest, Run } from '../../../src/api/index.js';
import { baseUrl, load, otherId, params, reply } from './helpers.js';

async function command() {
  const run = await load('run', 'Run');
  const body: CancelRunRequest = { scope: run.scope, requestId: otherId };
  return { run, body, input: { params: { ...params, runId: run.id }, body } };
}

it('posts scoped intent and accepts stopping without claiming terminal cancellation', async () => {
  const { run, input } = await command();
  const stopping: Run = { ...run, version: 2, cancellationRequested: true };
  const fetcher = reply(stopping, 202);
  expect(await createApiClient({ baseUrl, fetch: fetcher }).cancelRun(input))
    .toEqual({ ok: true, value: stopping });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toBe(`${new URL(baseUrl).origin}/api/v2/organizations/${params.organizationId}`
    + `/workspaces/${params.workspaceId}/runs/${run.id}/cancel`);
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual(input.body);
});

it('rejects scope mismatch and extra command fields before network effects', async () => {
  const { input } = await command(); const fetcher = reply({}, 202);
  const client = createApiClient({ baseUrl, fetch: fetcher });
  for (const body of [{ ...input.body, scope: { ...input.body.scope, workspaceId: otherId } },
    { ...input.body, force: true }, { ...input.body, expectedVersion: 1 }]) {
    expect(await client.cancelRun({ ...input, body })).toEqual({ ok: false, error: { kind: 'request' } });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects unrelated or unaccepted nonterminal responses', async () => {
  const { run, input } = await command();
  for (const value of [run, { ...run, cancellationRequested: true, id: otherId },
    { ...run, cancellationRequested: true, scope: { ...run.scope, workspaceId: otherId } }]) {
    expect(await createApiClient({ baseUrl, fetch: reply(value, 202) }).cancelRun(input))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('preserves an already completed outcome without manufacturing cancellation intent', async () => {
  const { run, input } = await command();
  const completed: Run = { ...run, state: 'finished', outcome: 'passed', validationStatus: 'passed' };
  expect(await createApiClient({ baseUrl, fetch: reply(completed, 202) }).cancelRun(input))
    .toEqual({ ok: true, value: completed });
});
