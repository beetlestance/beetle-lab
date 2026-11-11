// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { captureRunMetricSamplesCursor, encodeRunMetricSamplesCursor } from '@beetle/contracts/api';
import { json, mountMetrics, page, samples, series, testClient } from './fixtures.js';
afterEach(cleanup);
const fromText = '2024-05-01T23:59:59.123'; const toText = '2024-05-02T00:02:00.456';
const start = Date.parse(`${fromText}Z`); const end = Date.parse(`${toText}Z`);
function input(label: string, value: string) {fireEvent.change(screen.getByLabelText(label), {target: {value}});}
function bounds(from = fromText, to = toText) {input('From source time (UTC)', from); input('To source time (UTC)', to);}
function apply() {fireEvent.click(screen.getByRole('button', {name: 'Apply range'}));}
function selection(path: string) {
  const query = new URL(path, 'http://metrics.local').searchParams;
  return {from: query.get('fromTimeMs'), to: query.get('toTimeMs'), cursor: query.get('cursor')};
}
/** Replies obey generated-client position, range, overlap and series checks. */
function reply(path: string, paginate = false) {
  const query = new URL(path, 'http://metrics.local').searchParams;
  const cursor = query.get('cursor'); const before = cursor ? captureRunMetricSamplesCursor(cursor).beforeWindow : 2000;
  const fromTimeMs = Number(query.get('fromTimeMs') ?? 0); const toTimeMs = Number(query.get('toTimeMs') ?? 8640000000000000);
  const selected = {...series, ordinal: Number(query.get('seriesOrdinal'))};
  const source = samples(before, 1, selected); const startTimeMs = fromTimeMs + (before - 1900) * 1000;
  return {...source, fromTimeMs, toTimeMs, span: {startTimeMs, endTimeMs: startTimeMs + 1000},
    items: [{windowOrdinal: before, startTimeMs, endTimeMs: startTimeMs + 1000, value: {kind: 'counter' as const, sum: 1}}],
    nextCursor: paginate && before > 1981 ? encodeRunMetricSamplesCursor({organizationId: source.scope.organizationId,
      workspaceId: source.scope.workspaceId, runId: source.id, attemptId: source.attemptId, manifestDigest: source.manifestDigest,
      seriesOrdinal: selected.ordinal, fromTimeMs, toTimeMs, beforeWindow: before - 1}) : null};
}
function fixture(paginate = false) {
  const second = {...series, ordinal: 1, metric: 'other_metric'};
  return testClient(request => json(request.path.includes('/samples?') ? reply(request.path, paginate)
    : {...page(), totalSeries: 2, items: [series, second]}));
}
function paths(f: ReturnType<typeof testClient>) {return f.records.filter(request => request.path.includes('/samples?')).map(request => request.path);}
async function ready() {await screen.findByRole('img'); await waitFor(() => expect(screen.getByRole('button', {name: 'Latest samples'})).toBeEnabled());}
it('keeps drafts local, rejects missing/reversed bounds, applies UTC and preserves whole-run totals', async () => {
  const f = fixture(); mountMetrics(f.client); await ready();
  input('From source time (UTC)', fromText); expect(paths(f)).toHaveLength(1);
  apply(); expect(screen.getByRole('alert')).toHaveTextContent('Enter valid UTC source times'); expect(paths(f)).toHaveLength(1);
  bounds(toText, fromText); apply(); expect(paths(f)).toHaveLength(1);
  bounds(fromText, fromText); apply(); expect(paths(f)).toHaveLength(1);
  bounds('1969-12-31T23:59', toText); apply(); expect(paths(f)).toHaveLength(1);
  bounds(); expect(paths(f)).toHaveLength(1); apply(); await ready();
  expect(paths(f)).toHaveLength(2); expect(selection(paths(f)[1]!)).toEqual({from: String(start), to: String(end), cursor: null});
  expect(screen.getByText(/Applied source range:/)).toHaveTextContent(`${fromText}Z`);
  expect(screen.getByText(/Applied source range:/)).toHaveTextContent(`${toText}Z`);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByText(/Whole-run total:/).closest('p')).toHaveTextContent('2000 count');
});
it('retains immutable bounds through older/latest pages and resets to all source windows', async () => {
  const f = fixture(true); mountMetrics(f.client); await ready(); expect(paths(f)).toHaveLength(10);
  bounds(); apply(); await ready(); expect(paths(f)).toHaveLength(20);
  fireEvent.click(screen.getByRole('button', {name: 'Older samples'})); await ready(); expect(paths(f)).toHaveLength(30);
  expect(screen.getByRole('button', {name: 'Older samples'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {name: 'Latest samples'})); await ready(); expect(paths(f)).toHaveLength(40);
  for (const path of paths(f).slice(10)) expect(selection(path)).toMatchObject({from: String(start), to: String(end)});
  expect(selection(paths(f)[20]!).cursor).not.toBeNull(); expect(selection(paths(f)[30]!).cursor).toBeNull();
  fireEvent.click(screen.getByRole('button', {name: 'Reset range'})); await ready(); expect(paths(f)).toHaveLength(50);
  expect(selection(paths(f)[40]!)).toEqual({from: null, to: null, cursor: null});
  expect(screen.getByLabelText('From source time (UTC)')).toHaveValue(''); expect(screen.getByLabelText('To source time (UTC)')).toHaveValue('');
  expect(screen.queryByText(/Applied source range:/)).not.toBeInTheDocument();
});
it('aborts a retired range and waits for its exposed original before starting a replacement', async () => {
  const f = fixture(); const original = f.client.getRunMetricSamples;
  let reject!: (error: Error) => void;
  const hold = new Promise<Awaited<ReturnType<typeof original>>>((_resolve, fail) => {reject = fail;});
  const calls: Parameters<typeof original>[0][] = [];
  const api = {...f.client, getRunMetricSamples: (request: Parameters<typeof original>[0]) => {
    calls.push(request); return calls.length === 2 ? hold : original(request);
  }};
  mountMetrics(api); await ready(); bounds(); apply(); await waitFor(() => expect(calls).toHaveLength(2));
  bounds('2024-05-02T00:03:00', '2024-05-02T00:05:00'); apply();
  expect(calls[1]!.signal?.aborted).toBe(true); expect(calls).toHaveLength(2); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await act(async () => {reject(new Error('Retired request failed late'));}); await ready();
  expect(calls).toHaveLength(3); expect(calls[2]!.query).toMatchObject({fromTimeMs: Date.parse('2024-05-02T00:03:00Z'), toTimeMs: Date.parse('2024-05-02T00:05:00Z')});
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('resets the range when the selected series changes', async () => {
  const f = fixture(); mountMetrics(f.client); await ready(); bounds(); apply(); await ready();
  fireEvent.change(screen.getByLabelText('Metric series'), {target: {value: '1'}}); await ready();
  expect(paths(f)).toHaveLength(3); expect(selection(paths(f)[2]!)).toEqual({from: null, to: null, cursor: null});
  expect(screen.queryByText(/Applied source range:/)).not.toBeInTheDocument(); expect(screen.getByLabelText('From source time (UTC)')).toHaveValue('');
});
