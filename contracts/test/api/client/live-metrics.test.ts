import { expect, it, vi } from 'vitest';
import { createApiClient } from '../../../src/api/index.js';
import type { LiveMetricSnapshot } from '../../../src/api/index.js';
import { fixture } from '../fixtures.js';
const params = {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000005', attemptId: '00000000-0000-4000-8000-000000000006'};
it('binds live scope/attempt/generation independently of structurally valid replies', async () => {
  const value = await fixture('valid/live-metric-snapshot.json') as LiveMetricSnapshot;
  for (const scope of [{...value.scope, generation: 2}, {...value.scope, attemptId: params.runId},
    {...value.scope, workspaceId: params.runId}]) {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({...value, scope}), {headers: {'content-type': 'application/json'}}));
    const client = createApiClient({baseUrl: 'https://api.invalid', fetch: fetcher});
    expect(await client.getRunLiveMetrics({params})).toMatchObject({ok: false, error: {kind: 'response'}});
  }
});
it('caps the actual live response at64KiB even with the normal1MiB API transport allowance', async () => {
  const value = await fixture('valid/live-metric-snapshot.json');
  const text = JSON.stringify({...value as object, padding: 'x'.repeat(65536)});
  const fetcher = vi.fn<typeof fetch>(async () => new Response(text, {headers: {'content-type': 'application/json'}}));
  const client = createApiClient({baseUrl: 'https://api.invalid', fetch: fetcher});
  expect(await client.getRunLiveMetrics({params})).toMatchObject({ok: false, error: {kind: 'response'}});
});
