import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { CreateRunRequest, Run, SuiteRevision, WorkspaceSettings } from '@beetle/contracts/api';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { ids, json, readNamespace, testClient } from '../../app/test-fixtures.js';
import { RunSavedRevision } from './index.js';
export { ids, json, readNamespace, testClient, deferred, mount, apiError } from '../../app/test-fixtures.js';
export const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
export const runId = '11111111-1111-4111-8111-111111111111';
export const revisionId = '22222222-2222-4222-8222-222222222222';
export const suiteId = '33333333-3333-4333-8333-333333333333';
export const budget = { cpuMillis: 1000, memoryBytes: 1024, pids: 10, timeoutMs: 100, outputBytes: 2048 };
export function revision(organizationId = ids.a): SuiteRevision {
  return { id: revisionId, scope: { ...scope, organizationId }, suiteId, ordinal: 2, engineId: 'k6', configVersion: 1,
    digest: 'a'.repeat(64), config: { target: 'http://synthetic.invalid' }, inputManifest: [], preflightStatus: 'passed' };
}
export function settings(organizationId = ids.a): WorkspaceSettings {
  const source = { kind: 'installation' as const };
  return { id: ids.request, scope: { ...scope, organizationId }, version: 1, schemaVersion: 2, overrides: {},
    effective: { runDefaults: { engineProfile: { value: 'k6', source, allowedValues: ['k6', 'k6-small'] },
      budget: { cpuMillis: { value: 1000, source, allowedRange: { minimum: 1, maximum: 2000 } },
        memoryBytes: { value: 1024, source, allowedRange: { minimum: 1, maximum: 4096 } },
        pids: { value: 10, source, allowedRange: { minimum: 1, maximum: 100 } },
        timeoutMs: { value: 100, source, allowedRange: { minimum: 1, maximum: 1000 } },
        outputBytes: { value: 2048, source, allowedRange: { minimum: 1, maximum: 4096 } } } },
      retention: { value: { mode: 'manual' }, source } } };
}
export function run(organizationId = ids.a): Run {
  return { id: runId, scope: { ...scope, organizationId }, version: 1, suiteId, revisionId, revisionDigest: 'a'.repeat(64),
    requestedAt: '2026-11-10T00:00:00.000Z', state: 'queued', outcome: 'pending', validationStatus: 'pending',
    activeAttemptId: ids.request, cancellationRequested: false, reason: null,
    engine: { id: 'k6', profileId: 'k6', imageDigest: `sha256:${'b'.repeat(64)}`, configVersion: 1 },
    budget: { ...budget }, executionPolicy: { mode: 'parallel', preferIdle: false },
    settingsVersions: { installation: 1, organization: 1, workspace: 1 } };
}
export function receipt(body: CreateRunRequest): Run {
  return { ...run(body.scope.organizationId), revisionId: body.revisionId, engine: { ...run().engine, profileId: body.engineProfile },
    budget: body.budget, executionPolicy: body.executionPolicy };
}
function Location() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output aria-label="Current route">{location.pathname}</output>
    <button onClick={() => void navigate('/retired')}>Leave form</button></>;
}
export function mountLauncher(client: ReturnType<typeof testClient>['client']) {
  const queryClient = createQueryClient();
  function Surface() {
    const location = useLocation();
    return <>{location.pathname === '/' && <RunSavedRevision revision={revision()} />}<Location /></>;
  }
  return { queryClient, ...render(<MemoryRouter><ApiContext.Provider value={client}><QueryClientProvider client={queryClient}>
    <Surface />
  </QueryClientProvider></ApiContext.Provider></MemoryRouter>) };
}
export function runRead(request: Parameters<typeof readNamespace>[0]) {
  const organizationId = request.path.includes(ids.b) ? ids.b : ids.a;
  if (request.path.includes('/runs?')) return json({ scope: { ...scope, organizationId }, items: [run(organizationId)], nextCursor: null });
  if (request.path.endsWith(`/runs/${runId}`)) return json(run(organizationId));
  return readNamespace(request);
}
