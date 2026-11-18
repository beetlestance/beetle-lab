// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import data from '../../../../../contracts/fixtures/api/valid/live-metric-history.json' with { type: 'json' };
import { captureLiveMetricHistory } from '@beetle/contracts/api';
import type { LiveMetricHistory } from '@beetle/contracts/api';
import { useHistoryBootstrap } from './useBootstrap.js';
import { deferred } from '../live-metrics/fixtures.js';
const value = () => captureLiveMetricHistory(data, () => data.subsetDigest);
const params = {
  organizationId: data.scope.organizationId,
  workspaceId: data.scope.workspaceId,
  attemptId: data.scope.attemptId,
  runId: '00000000-0000-4000-8000-000000000099',
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('boots once for a ready lease and again only for a new reconnect trigger', async () => {
  const read = vi.fn(async () => value());
  const reads = { read };
  const accept = vi.fn();
  const trigger = {};
  const view = renderHook(({ trigger }) => useHistoryBootstrap(params, trigger, true, accept, reads), {
    initialProps: { trigger },
  });
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  view.rerender({ trigger });
  expect(read).toHaveBeenCalledTimes(1);
  view.rerender({ trigger: {} });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  expect(accept).toHaveBeenCalledTimes(2);
});
it('fences late results from a retired lease without blocking the next owner', async () => {
  const gate = deferred<LiveMetricHistory>();
  const read = vi.fn(async () => value()).mockImplementationOnce(() => gate.promise);
  const reads = { read };
  const accept = vi.fn();
  const view = renderHook(({ trigger }) => useHistoryBootstrap(params, trigger, true, accept, reads), {
    initialProps: { trigger: {} },
  });
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  view.rerender({ trigger: {} });
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  await act(async () => gate.resolve(value()));
  expect(accept).toHaveBeenCalledTimes(1);
});
it('does not apply ignored-abort results after the30s presentation deadline', async () => {
  vi.useFakeTimers();
  const gate = deferred<LiveMetricHistory>();
  const read = vi.fn(() => gate.promise);
  const reads = { read };
  const accept = vi.fn();
  const trigger = {};
  const view = renderHook(() => useHistoryBootstrap(params, trigger, true, accept, reads));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(view.result.current.status).toBe('unavailable');
  await act(async () => gate.resolve(value()));
  expect(accept).not.toHaveBeenCalled();
});
it('converts a synchronous read-port failure into explicit unavailable state', async () => {
  const reads = {
    read: vi.fn(() => {
      throw Error('Synthetic port failure');
    }),
  };
  const trigger = {};
  const view = renderHook(() => useHistoryBootstrap(params, trigger, true, () => {}, reads));
  await waitFor(() => expect(view.result.current.status).toBe('unavailable'));
});

it('dispatches exactly once through StrictMode effect replay', async () => {
  const reads = { read: vi.fn(async () => value()) };
  const trigger = {};
  const accept = vi.fn();
  const view = renderHook(() => useHistoryBootstrap(params, trigger, true, accept, reads), { wrapper: StrictMode });
  await waitFor(() => expect(view.result.current.status).toBe('ready'));
  expect(reads.read).toHaveBeenCalledTimes(1);
  expect(accept).toHaveBeenCalledTimes(1);
});
