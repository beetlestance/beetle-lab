// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { validate } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import passed from '../../../../../contracts/fixtures/valid/passed-result.json' with {type: 'json'};
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { testClient, json } from '../../../app/test-fixtures.js';
import { run } from '../test-fixtures.js';
import { RunResultRead } from '../RunResultRead.js';
import { performanceReportReads } from './read.js';
import { artifact, report } from './fixtures.js';
afterEach(() => {cleanup(); vi.restoreAllMocks();});
function result(current: Run, duplicate = false) {
  const value = validate('EngineResult', {...passed, organizationId: current.scope.organizationId,
    workspaceId: current.scope.workspaceId, attemptId: current.activeAttemptId,
    artifacts: duplicate ? [artifact, {...artifact, artifactId: '00000000-0000-4000-8000-000000000009'}] : [artifact]});
  if (!value.ok) throw new Error('Invalid synthetic result'); return value.value;
}
function mount(current: Run, duplicate = false, requested = current) {
  const {client} = testClient(async () => json({id: current.id, scope: current.scope, activeAttemptId: current.activeAttemptId, result: result(current, duplicate)}));
  const queries = createQueryClient();
  return render(<QueryClientProvider client={queries}><ApiContext.Provider value={client}>
    <RunResultRead scope={requested.scope} runId={requested.id} run={requested} terminal={true} />
  </ApiContext.Provider></QueryClientProvider>);
}
it('uses the existing verified result and binds its selected descriptor to scoped content reads', async () => {
  const read = vi.spyOn(performanceReportReads, 'read').mockResolvedValue(report); const current = run(); mount(current);
  await screen.findByRole('region', {name: 'Verified performance report'});
  expect(read).toHaveBeenCalledTimes(1); expect(read.mock.calls[0]?.[0]).toMatchObject({params: {
    organizationId: current.scope.organizationId, workspaceId: current.scope.workspaceId, runId: current.id,
    attemptId: current.activeAttemptId, artifactId: artifact.artifactId}});
});
it('refuses ambiguous report artifacts without silently selecting one', async () => {
  const read = vi.spyOn(performanceReportReads, 'read').mockResolvedValue(report); mount(run(), true);
  await screen.findByText('Multiple performance reports were published; this view requires one report.'); expect(read).not.toHaveBeenCalled();
});
it('does not start artifact reads for a result outside the requested namespace', async () => {
  const read = vi.spyOn(performanceReportReads, 'read').mockResolvedValue(report); const current = run();
  mount(current, false, {...current, scope: {...current.scope, organizationId: '00000000-0000-4000-8000-000000000009'}});
  await waitFor(() => expect(screen.queryByText('Loading result details…')).toBeNull());
  expect(screen.queryByRole('region', {name: 'Verified performance report'})).toBeNull(); expect(read).not.toHaveBeenCalled();
});
