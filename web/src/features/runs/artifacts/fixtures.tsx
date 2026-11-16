import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { encodeRunArtifactCursor } from '@beetle/contracts/api';
import type { ApiClient, Run, RunArtifactPage } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { RunDetail } from '../RunDetail.js';
import { pendingArtifacts, run } from '../test-fixtures.js';
import { RunArtifacts } from './index.js';
export { testClient } from '../../../app/test-fixtures.js';
export { run, ids, json, deferred, apiError, emptyEvents, resultSnapshot } from '../test-fixtures.js';
export const artifactId = '44444444-4444-4444-8444-444444444444';
export function artifact(index = 0): RunArtifactPage['items'][number] {
  return { artifactId: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`, kind: 'raw',
    relativePath: `reports/file-${index}.bin`, bytes: 9007199254740991, sha256: 'b'.repeat(64), sealedAt: '2026-11-10T00:00:00Z' };
}
export function page(current = run(), availability: RunArtifactPage['availability'] = 'ready'): RunArtifactPage {
  const pending = pendingArtifacts(current);
  return availability === 'ready' ? { ...pending, availability, manifestDigest: 'a'.repeat(64),
    items: [{ ...artifact(), artifactId }] } : { ...pending, availability };
}
export function cursor(current = run(), manifestDigest = 'a'.repeat(64)) {
  return encodeRunArtifactCursor({ lane: 'artifacts', organizationId: current.scope.organizationId,
    workspaceId: current.scope.workspaceId, runId: current.id, attemptId: current.activeAttemptId,
    generation: 1, manifestDigest, ordinal: 100 });
}
export function mountArtifacts(api: ApiClient, initial = run(), terminal = false, composed = false) {
  const client = createQueryClient();
  function surface(current: Run, done: boolean, source: ApiClient) {
    return <MemoryRouter><ApiContext.Provider value={source}><QueryClientProvider client={client}>
      {composed ? <RunDetail organizationId={current.scope.organizationId} workspaceId={current.scope.workspaceId} runId={current.id} />
        : <RunArtifacts run={current} terminal={done} />}
    </QueryClientProvider></ApiContext.Provider></MemoryRouter>;
  }
  const view = render(surface(initial, terminal, api));
  return { ...view, client, select: (current: Run, done = false, source = api) => view.rerender(surface(current, done, source)) };
}
