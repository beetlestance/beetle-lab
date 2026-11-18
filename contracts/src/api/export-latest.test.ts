import { expect, it } from 'vitest';
import { createApiClient, latestRevisionExportMatches, validateApi } from './index.js';
import type { LatestRevisionExport } from './index.js';
import jobFixture from '../../fixtures/api/valid/export-job.json' with { type: 'json' };
const checked = validateApi('ExportJob', jobFixture);
if (!checked.ok) throw new Error('Invalid export fixture');
const job = { ...checked.value, state: 'queued' as const, artifact: null, reason: null };
const value: LatestRevisionExport = { scope: job.scope, revisionId: job.revisionId, job };
const other = '99999999-9999-4999-8999-999999999999';

it('binds the wrapper and nested job to the exact revision and workspace with existing state semantics', () => {
  expect(validateApi('LatestRevisionExport', value).ok).toBe(true);
  expect(latestRevisionExportMatches(value, job.scope, job.revisionId)).toBe(true);
  expect(latestRevisionExportMatches({ ...value, job: null }, job.scope, job.revisionId)).toBe(true);
  const wrongReplies: LatestRevisionExport[] = [
    { ...value, job: { ...job, madeAt: '2026-11-12T00:00:00.000Z' } },
    { ...value, revisionId: other },
    { ...value, scope: { ...job.scope, workspaceId: other } },
    { ...value, job: { ...job, revisionId: other } },
    { ...value, job: { ...job, scope: { ...job.scope, workspaceId: other } } },
    { ...value, job: { ...job, state: 'cancelled' as const, reason: 'cancelled', cancellationRequested: false } },
  ];
  for (const wrong of wrongReplies) expect(latestRevisionExportMatches(wrong, job.scope, job.revisionId)).toBe(false);
  expect(
    latestRevisionExportMatches(
      { ...value, job: { ...job, state: 'failed', reason: 'execution_lost' } },
      job.scope,
      job.revisionId,
    ),
  ).toBe(true);
});

it('validates ownership through the generated HTTP client and emits no unrelated page query', async () => {
  let reply = value;
  let requested = '';
  const client = createApiClient({
    baseUrl: 'http://synthetic.invalid',
    fetch: async (input) => {
      requested = String(input);
      return Response.json(reply);
    },
  });
  const params = {
    organizationId: job.scope.organizationId,
    workspaceId: job.scope.workspaceId,
    revisionId: job.revisionId,
  };
  expect((await client.getLatestRevisionExport({ params })).ok).toBe(true);
  expect(requested).toBe(
    `http://synthetic.invalid/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/revisions/${params.revisionId}/exports/latest`,
  );
  reply = { ...value, job: { ...job, revisionId: other } };
  expect((await client.getLatestRevisionExport({ params })).ok).toBe(false);
});
