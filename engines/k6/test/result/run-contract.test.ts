import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { mapK6Result } from '../../wrapper/result/index.js';
import { discoveryConfig, fixture } from './fixtures.js';
import template from '../../../../contracts/fixtures/api/valid/run.json' with { type: 'json' };
import page from '../../../../contracts/fixtures/api/valid/run-page.json' with { type: 'json' };

it('carries real completed discovery exhaustion through public run detail and history', async () => {
  const mapped = mapK6Result(fixture(discoveryConfig()));
  expect(mapped).toMatchObject({ ok: true, body: { mode: 'discovery', outcome: 'inconclusive',
    completeness: 'complete', execution: { status: 'completed', exitCode: 0 }, expectedAbort: { reached: false } } });
  if (!mapped.ok) throw new Error('Expected completed discovery result');
  const checked = validateApi('Run', template);
  if (!checked.ok) throw new Error('Invalid synthetic run');
  const run: Run = { ...checked.value, state: 'finished', outcome: mapped.body.outcome,
    activeAttemptId: mapped.body.attemptId, validationStatus: 'passed', version: 4 };
  const params = { organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId };
  const history = { scope: run.scope, items: [run], nextCursor: null,
    summaries: [{ ...page.summaries[0]!, runId: run.id, attemptId: run.activeAttemptId }] };
  const client = createApiClient({ baseUrl: 'https://api.invalid', fetch: async input =>
    Response.json(String(input).endsWith(`/${run.id}`) ? run : history) });
  expect(await client.getRun({ params: { ...params, runId: run.id } })).toEqual({ ok: true, value: run });
  expect(await client.listRuns({ params, query: { limit: 10 } }))
    .toEqual({ ok: true, value: history });
});
