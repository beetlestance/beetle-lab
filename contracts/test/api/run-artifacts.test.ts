import { expect, it } from 'vitest';
import { validateApi, runArtifactContentPath } from '../../src/api/index.js';
import { fixture } from './fixtures.js';
it('validates bounded attempt-scoped publication metadata', async () => {
  const value = await fixture('valid/run-artifacts-pending.json') as Record<string, unknown>;
  expect(validateApi('RunArtifactPage', value).ok).toBe(true);
  expect(validateApi('RunArtifactPage', { ...value, generation: 2 }).ok).toBe(false);
  expect(validateApi('RunArtifactPage', { ...value, other: 1 }).ok).toBe(false);
  expect(validateApi('RunArtifactPage', { ...value, availability: 'assumed' }).ok).toBe(false);
});
it('builds only the same-origin five-UUID content path', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const params = { organizationId: id, workspaceId: id, runId: id, attemptId: id, artifactId: id };
  expect(runArtifactContentPath(params)).toBe(`/api/v2/organizations/${id}/workspaces/${id}/runs/${id}/attempts/${id}/artifacts/${id}/content`);
  expect(() => runArtifactContentPath({ ...params, artifactId: '../../private' })).toThrow();
  expect(() => runArtifactContentPath({ ...params, artifactId: 'https://other.invalid/' })).toThrow();
});
