// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { apiError } from '../../app/test-fixtures.js';
import { queryKeys } from '../../app/queries.js';
import { environment, exportJob, json, revision, testClient } from './fixtures.js';
import { useRevisionExport } from './useRevisionExport.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});
it('stops latest-job polling after a failed refresh even when a live job remains cached', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  focusManager.setFocused(true);
  const rev = revision();
  const job = exportJob();
  let unavailable = false;
  let latestReads = 0;
  const api = testClient((request) => {
    if (request.path.endsWith('/exports/latest')) {
      latestReads++;
      return unavailable
        ? json(apiError('storage_unavailable'), 503)
        : json({ scope: rev.scope, revisionId: rev.id, job });
    }
    if (request.path.endsWith(`/exports/${job.id}`)) return json(job);
    throw new Error('Unexpected synthetic export route');
  });
  const e = environment(api.client);
  const view = renderHook(() => useRevisionExport(rev), { wrapper: e.Frame });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(view.result.current.listing.isSuccess).toBe(true);
  unavailable = true;
  const queryKey = queryKeys.latestRevisionExport(rev.scope.organizationId, rev.scope.workspaceId, rev.id);
  await act(async () => {
    await e.client.refetchQueries({ queryKey, exact: true }, { cancelRefetch: false });
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(view.result.current.listing.isError).toBe(true);
  expect(view.result.current.listing.data?.job?.id).toBe(job.id);
  const stoppedAt = latestReads;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(latestReads).toBe(stoppedAt);
  expect(stoppedAt).toBe(2);
  e.client.clear();
});
