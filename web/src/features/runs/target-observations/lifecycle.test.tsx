// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../app/api.js';
import { testClient } from '../../../app/test-fixtures.js';
import type { ApiClient } from '@beetle/contracts/api';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import type { TargetRead } from './read.js';
import { RunTargetObservations } from './index.js';
import { deferred, fixture, report } from './read-fixtures.js';
afterEach(cleanup);
function session() {return testClient(async () => {throw new Error('Unexpected metadata request');}).client;}
function changedReport() {
  const value = report(); return {...value, samples: value.samples.map(row => ({...row, values: {...row.values, rss: 777}}))};
}
function surface(api: ApiClient, selection: Pick<TargetRead, 'params' | 'artifact'>, reads: {read: (input: TargetRead) => Promise<TargetRuntimeReport>}) {
  return <ApiContext.Provider value={api}><RunTargetObservations {...selection} reads={reads} /></ApiContext.Provider>;
}
it.each(['scope', 'attempt', 'session'] as const)('retires late responses across %s changes', async kind => {
  const f = fixture(); const first = deferred<TargetRuntimeReport>(); const second = deferred<TargetRuntimeReport>();
  const signals: AbortSignal[] = [];
  const read = vi.fn((input: TargetRead) => {signals.push(input.signal); return signals.length === 1 ? first.promise : second.promise;});
  const reads = {read}; const api = session(); const view = render(surface(api, f.input, reads));
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  const params = {...f.params};
  if (kind === 'scope') params.organizationId = '00000000-0000-4000-8000-000000000009';
  if (kind === 'attempt') params.attemptId = '00000000-0000-4000-8000-000000000009';
  view.rerender(surface(kind === 'session' ? session() : api, {...f.input, params}, reads));
  expect(screen.getByRole('status')).toHaveTextContent('Loading target'); expect(signals[0]!.aborted).toBe(true);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  await act(async () => {second.resolve(changedReport());});
  expect(screen.getByRole('combobox', {name: 'Target metric'})).toHaveValue('rss');
  expect(screen.getByText('777', {selector: 'dd'})).toBeInTheDocument();
  await act(async () => {first.resolve(report());});
  expect(screen.queryByText('1024', {selector: 'dd'})).toBeNull(); expect(screen.getByText('777', {selector: 'dd'})).toBeInTheDocument();
});
it('retires previously displayed values immediately when a new owner is loading', async () => {
  const f = fixture(); const pending = deferred<TargetRuntimeReport>(); let calls = 0;
  const reads = {read: vi.fn(async () => ++calls === 1 ? report() : pending.promise)}; const api = session();
  const view = render(surface(api, f.input, reads)); await screen.findByText('1024', {selector: 'dd'});
  view.rerender(surface(api, {...f.input, params: {...f.params, runId: '00000000-0000-4000-8000-000000000009'}}, reads));
  expect(screen.queryByText('1024', {selector: 'dd'})).toBeNull(); expect(screen.getByRole('status')).toHaveTextContent('Loading target');
  await act(async () => {pending.resolve(changedReport());});
});
it('requires an explicit retry after errors and keeps missing values explicit', async () => {
  const f = fixture(); const read = vi.fn<({signal}: TargetRead) => Promise<TargetRuntimeReport>>().mockRejectedValueOnce(new Error('private URL')).mockResolvedValueOnce(report());
  render(surface(session(), f.input, {read})); await screen.findByRole('alert');
  expect(screen.queryByText('private URL')).toBeNull(); expect(read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', {name: 'Reload target report'}));
  await screen.findByRole('combobox', {name: 'Target metric'}); expect(read).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByRole('combobox'), {target: {value: 'heapAlloc'}});
  expect(screen.getByRole('status')).toHaveTextContent('No readings available');
  expect(screen.getByText('No usable last after point was recorded; cooldown recovery is unknown.')).toBeInTheDocument();
});
it('handles StrictMode retirement and unmount without dispatching an abandoned effect', async () => {
  const f = fixture(); const pending = deferred<TargetRuntimeReport>(); let signal!: AbortSignal;
  const reads = {read: vi.fn(async (input: TargetRead) => {signal = input.signal; return pending.promise;})};
  const view = render(<StrictMode>{surface(session(), f.input, reads)}</StrictMode>);
  await waitFor(() => expect(reads.read).toHaveBeenCalledTimes(1)); view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => {pending.resolve(report());}); expect(screen.queryByRole('combobox')).toBeNull();
});
