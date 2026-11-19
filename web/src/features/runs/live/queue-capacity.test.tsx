// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import queueData from '../../../../../contracts/fixtures/api/valid/run-queue.json' with { type: 'json' };
import { json, liveRun, mountLive, routesFor } from './fixtures.js';
afterEach(cleanup);
it.each([
  ['capacity_unknown', 'Waiting for a current capacity reading from the agent.'],
  [
    'per_run_ceiling',
    'This run exceeds the current per-run resource limit. Review installation capacity and settings.',
  ],
])('explains %s without hiding the queued run or cancellation', async (reason, text) => {
  const run = liveRun({ state: 'queued', startedAt: null });
  const fixture = routesFor(
    () => run,
    (request) =>
      request.path.endsWith('/queue')
        ? json({
            ...queueData,
            scope: run.scope,
            runId: run.id,
            state: 'queued',
            waiting: 'backend_queue',
            capacityBlockReason: reason,
            position: 1,
            holders: [],
            otherWorkspaceRuns: 0,
            slots: { used: 0, runs: 0, exports: 0, configured: 2, effective: reason === 'capacity_unknown' ? null : 2 },
          })
        : undefined,
  );
  const cancel = {
    pending: false,
    unknown: false,
    accepted: false,
    message: null,
    request: vi.fn(async () => undefined),
  };
  mountLive(fixture.client, { run, cancel });
  expect(await screen.findByText(text)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'steady-1.2k is waiting for capacity' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
  expect(cancel.request).toHaveBeenCalledOnce();
});
