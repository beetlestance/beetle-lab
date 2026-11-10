import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '../../../src/api/index.js';
import result from '../../../fixtures/seal-v1/passed-result.json' with { type: 'json' };
import { baseUrl, otherId, reply } from './helpers.js';

const params = { organizationId: result.organizationId, workspaceId: result.workspaceId,
  runId: '00000000-0000-4000-8000-000000000090' };
const snapshot = () => ({ id: params.runId, scope: { kind: 'workspace' as const,
  organizationId: params.organizationId, workspaceId: params.workspaceId }, activeAttemptId: result.attemptId, result });
it.each([false, true])('reads a scoped result snapshot, pending=%s', async pending => {
  const value = { ...snapshot(), result: pending ? null : result };
  expect(validateApi('RunResultSnapshot', value).ok).toBe(true);
  const fetcher = reply(value);
  expect(await createApiClient({ baseUrl, fetch: fetcher }).getRunResult({ params })).toEqual({ ok: true, value });
  expect(String(fetcher.mock.calls[0]![0])).toContain(`/runs/${params.runId}/result`);
});
it.each(['id', 'attempt', 'organization', 'workspace'] as const)('rejects structurally valid mismatched %s', async field => {
  const value = snapshot();
  if (field === 'id') value.id = otherId;
  else value.result = { ...result, [field === 'attempt' ? 'attemptId' : field === 'organization' ? 'organizationId' : 'workspaceId']: otherId };
  expect(validateApi('RunResultSnapshot', value).ok).toBe(true);
  expect(await createApiClient({ baseUrl, fetch: reply(value) }).getRunResult({ params }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});
it('shares the existing engine-result schema and rejects invented terminal success shapes', () => {
  for (const invalid of [{ ...result, outcome: 'unknown' },
    { ...result, execution: { status: 'errored' } }, { ...result, secretValues: { token: 'synthetic' } }]) {
    expect(validateApi('RunResultSnapshot', { ...snapshot(), result: invalid }).ok).toBe(false);
  }
});

it('rejects a structurally valid future generation in the generation-one run view', async () => {
  const value = { ...snapshot(), result: { ...result, generation: 2 } };
  expect(validateApi('RunResultSnapshot', value).ok).toBe(true);
  expect(await createApiClient({ baseUrl, fetch: reply(value) }).getRunResult({ params }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});
it('bounds a structurally valid result reply independently of the general API allowance', async () => {
  const artifacts = Array.from({ length: 128 }, (_, index) => ({ ...result.artifacts[0]!,
    artifactId: `00000000-0000-4000-8000-${(1000 + index).toString(16).padStart(12, '0')}`,
    relativePath: `reports/${('a'.repeat(220) + '/').repeat(2)}summary-${index}.json` }));
  const value = { ...snapshot(), result: { ...result, artifacts } };
  expect(validateApi('RunResultSnapshot', value).ok).toBe(true);
  expect(JSON.stringify(value).length).toBeGreaterThan(73728);
  expect(await createApiClient({ baseUrl, fetch: reply(value) }).getRunResult({ params }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});
