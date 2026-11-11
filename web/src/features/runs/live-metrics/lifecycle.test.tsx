// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LiveMetricReads } from './read.js';
import { activeRun, deferred, flush, session, surface, value } from './ui-fixtures.js';
let visibility: DocumentVisibilityState = 'visible';
beforeEach(() => {vi.useFakeTimers(); visibility = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);});
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.useRealTimers();});
it('starts the next poll two seconds after its previous original settles', async () => {
  const gate = deferred<ReturnType<typeof value>>();
  const read = vi.fn<LiveMetricReads['read']>(() => gate.promise); const current = activeRun();
  render(surface(session(), current, {read})); await flush(); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(1000);}); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {gate.resolve(value(current));}); await flush();
  expect(screen.getByRole('cell', {name: '42 count'})).toBeInTheDocument();
  await act(async () => {await vi.advanceTimersByTimeAsync(1999);}); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(1);}); expect(read).toHaveBeenCalledTimes(2);
});
it('survives StrictMode with one issued original and fences unmount', async () => {
  const gate = deferred<ReturnType<typeof value>>(); const read = vi.fn<LiveMetricReads['read']>(() => gate.promise);
  const view = render(<StrictMode>{surface(session(), activeRun(), {read})}</StrictMode>); await flush();
  expect(read).toHaveBeenCalledTimes(1); view.unmount(); expect(read.mock.calls[0]![0].signal.aborted).toBe(true);
  await act(async () => {gate.resolve(value());}); await flush();
  await act(async () => {await vi.advanceTimersByTimeAsync(5000);}); expect(read).toHaveBeenCalledTimes(1);
});
it.each(['scope', 'attempt', 'session'] as const)('retires ignored late replies across %s changes', async kind => {
  const first = deferred<ReturnType<typeof value>>(); const second = deferred<ReturnType<typeof value>>();
  const read = vi.fn<LiveMetricReads['read']>().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const api = session(); const current = activeRun(); const next = structuredClone(current);
  if (kind === 'scope') next.scope.organizationId = '00000000-0000-4000-8000-000000000099';
  if (kind === 'attempt') next.activeAttemptId = '00000000-0000-4000-8000-000000000099';
  const reads = {read}; const view = render(surface(api, current, reads)); await flush();
  view.rerender(surface(kind === 'session' ? session() : api, next, reads)); await flush();
  expect(read).toHaveBeenCalledTimes(2); expect(read.mock.calls[0]![0].signal.aborted).toBe(true);
  await act(async () => {second.resolve(value(next, 99));}); await flush();
  expect(screen.getByRole('cell', {name: '99 count'})).toBeInTheDocument();
  await act(async () => {first.resolve(value(current));}); await flush();
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
});
it('pauses on hidden documents, drains the prior original before resuming and retires old display data', async () => {
  const gate = deferred<ReturnType<typeof value>>(); const read = vi.fn<LiveMetricReads['read']>().mockImplementationOnce(() => gate.promise);
  const current = activeRun(); render(surface(session(), current, {read})); await flush();
  visibility = 'hidden'; await act(async () => {document.dispatchEvent(new Event('visibilitychange'));});
  expect(read.mock.calls[0]![0].signal.aborted).toBe(true); expect(screen.getByText('Live metrics paused.')).toBeInTheDocument();
  await act(async () => {await vi.advanceTimersByTimeAsync(10000);}); expect(read).toHaveBeenCalledTimes(1);
  visibility = 'visible'; await act(async () => {document.dispatchEvent(new Event('visibilitychange'));}); await flush();
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(value(current, 99, 2));
  await act(async () => {gate.resolve(value(current));}); await flush();
  expect(read).toHaveBeenCalledTimes(2); expect(screen.getByRole('cell', {name: '99 count'})).toBeInTheDocument();
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
});
it('expires unchanged source data even when the wall clock freezes and another poll is held', async () => {
  const current = activeRun(); const initial = value(current); const held = deferred<ReturnType<typeof value>>();
  const read = vi.fn<LiveMetricReads['read']>().mockResolvedValueOnce(initial).mockImplementation(() => held.promise);
  render(surface(session(), current, {read})); await flush();
  expect(screen.getByRole('cell', {name: '42 count'})).toBeInTheDocument();
  await act(async () => {await vi.advanceTimersByTimeAsync(6000);});
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
  expect(screen.getByText(/Live metrics expired/)).toBeInTheDocument();
  await act(async () => {held.resolve({...initial, receivedMono: performance.now(), expiresAtMono: performance.now() + 6000});}); await flush();
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
});
it('stops on cancellation and replaces values with explicit unavailable data after an error', async () => {
  const current = activeRun(); const read = vi.fn<LiveMetricReads['read']>().mockResolvedValueOnce(value(current)).mockRejectedValue(new Error('private diagnostic'));
  const api = session(); const reads = {read}; const view = render(surface(api, current, reads)); await flush();
  await act(async () => {await vi.advanceTimersByTimeAsync(2000);});
  expect(screen.getByText(/Live metrics unavailable/)).toBeInTheDocument(); expect(screen.queryByText('private diagnostic')).not.toBeInTheDocument();
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
  view.rerender(surface(api, {...current, cancellationRequested: true}, reads)); await flush();
  const calls = read.mock.calls.length; await act(async () => {await vi.advanceTimersByTimeAsync(10000);}); expect(read).toHaveBeenCalledTimes(calls);
});

it('shows a five-second read failure while retaining the ignored-abort original until it settles', async () => {
  const gate = deferred<ReturnType<typeof value>>();
  const read = vi.fn<LiveMetricReads['read']>().mockImplementationOnce(() => gate.promise).mockResolvedValue(value());
  render(surface(session(), activeRun(), {read})); await flush();
  await act(async () => {await vi.advanceTimersByTimeAsync(10000);});
  expect(read).toHaveBeenCalledTimes(1); expect(read.mock.calls[0]![0].signal.aborted).toBe(true);
  expect(screen.getByText(/Live metrics unavailable/)).toBeInTheDocument();
  await act(async () => {gate.resolve(value());}); await flush();
  expect(screen.queryByRole('cell', {name: '42 count'})).not.toBeInTheDocument();
  await act(async () => {await vi.advanceTimersByTimeAsync(1999);}); expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(1);}); expect(read).toHaveBeenCalledTimes(2);
});

it('bounds visible waiting behind an old original and keeps only the latest resume callback', async () => {
  const gate = deferred<ReturnType<typeof value>>(); const current = activeRun();
  const read = vi.fn<LiveMetricReads['read']>().mockImplementationOnce(() => gate.promise);
  render(surface(session(), current, {read})); await flush();
  for (let turn = 0; turn < 10; turn++) {
    visibility = 'hidden'; await act(async () => {document.dispatchEvent(new Event('visibilitychange'));});
    visibility = 'visible'; await act(async () => {document.dispatchEvent(new Event('visibilitychange'));});
  }
  await act(async () => {await vi.advanceTimersByTimeAsync(6000);});
  expect(read).toHaveBeenCalledTimes(1); expect(screen.getByText(/Live metrics unavailable/)).toBeInTheDocument();
  read.mockResolvedValue(value(current, 99, 2));
  await act(async () => {gate.resolve(value(current));}); await flush();
  expect(read).toHaveBeenCalledTimes(2); expect(screen.getByRole('cell', {name: '99 count'})).toBeInTheDocument();
});
