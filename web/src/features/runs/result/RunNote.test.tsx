// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { apiError, deferred, json, run, testClient } from '../test-fixtures.js';
import { RunNote } from './RunNote.js';
afterEach(cleanup);
const stamp = '2026-11-19T14:10:00.000Z';
const initial = (): Run => ({ ...run(), note: 'Original', noteVersion: 1, noteUpdatedAt: stamp });
function mountNote(client: ReturnType<typeof testClient>['client'], value = initial(), readOnly = false) {
  const queryClient = createQueryClient();
  const view = (value: Run) => <ApiContext.Provider value={client}><QueryClientProvider client={queryClient}>
    <RunNote run={value} readOnly={readOnly} />
  </QueryClientProvider></ApiContext.Provider>;
  const mounted = render(view(value));
  return { ...mounted, update: (next: Run) => mounted.rerender(view(next)) };
}
function edit() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
  fireEvent.change(screen.getByLabelText('Run note'), { target: { value: 'Mine' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
}
it('freezes the draft while saving and on unknown outcome; replays identical bytes', async () => {
  const pending = deferred<Response>(); let writes = 0;
  const f = testClient(() => ++writes === 1 ? pending.promise : json({ ...initial(), note: 'Mine', noteVersion: 2 }));
  mountNote(f.client); edit();
  expect(screen.getByLabelText('Run note')).toHaveAttribute('readonly');
  pending.resolve(json(apiError('capacity_unavailable'), 503));
  await screen.findByRole('button', { name: 'Retry the same save' });
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save note' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry the same save' }));
  await screen.findByText('Mine', { selector: 'p' });
  expect(f.records[0]!.body).toEqual(f.records[1]!.body);
});
it('keeps the opened version through a passive refresh, then replaces only a freshly read conflict version', async () => {
  let writes = 0;
  const f = testClient(request => request.method === 'GET'
    ? json({ ...initial(), note: 'Theirs', noteVersion: 3 })
    : ++writes === 1 ? json(apiError('conflict'), 409)
      : json({ ...initial(), note: 'Mine', noteVersion: 4 }));
  const mounted = mountNote(f.client);
  fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
  fireEvent.change(screen.getByLabelText('Run note'), { target: { value: 'Mine' } });
  mounted.update({ ...initial(), note: 'Passive change', noteVersion: 2 });
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
  await screen.findByRole('button', { name: 'Replace with mine' });
  expect(screen.getByLabelText('Run note')).toHaveValue('Mine');
  fireEvent.click(screen.getByRole('button', { name: 'Replace with mine' }));
  await screen.findByText('Mine', { selector: 'p' });
  const writesSent = f.records.filter(r => r.method === 'PATCH');
  expect(writesSent.map(r => r.body)).toEqual([
    expect.objectContaining({ expectedNoteVersion: 1, note: 'Mine' }),
    expect.objectContaining({ expectedNoteVersion: 3, note: 'Mine' }),
  ]);
  expect(writesSent[0]!.body).not.toEqual(writesSent[1]!.body);
});
it('keeps a draft on failed conflict reads and lets the user accept a confirmed remote note without a write', async () => {
  let reads = 0;
  const f = testClient(request => request.method !== 'GET' ? json(apiError('conflict'), 409)
    : ++reads === 1 ? json(apiError('capacity_unavailable'), 503)
      : json({ ...initial(), note: 'Theirs', noteVersion: 2 }));
  mountNote(f.client); edit();
  fireEvent.click(await screen.findByRole('button', { name: 'Read latest note' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use theirs' }));
  await screen.findByText('Theirs', { selector: 'p' });
  expect(f.records.filter(r => r.method === 'PATCH')).toHaveLength(1);
});
it('fences a late conflict read after the editor unmounts', async () => {
  const pending = deferred<Response>();
  const f = testClient(request => request.method === 'GET' ? pending.promise : json(apiError('conflict'), 409));
  const mounted = mountNote(f.client); edit();
  await waitFor(() => expect(f.records.filter(r => r.method === 'GET')).toHaveLength(1));
  mounted.unmount();
  pending.resolve(json({ ...initial(), note: 'Theirs', noteVersion: 2 }));
  await Promise.resolve();
  expect(screen.queryByRole('button', { name: 'Replace with mine' })).not.toBeInTheDocument();
});
it('shows the recorded timestamp in restored history without editing controls, and never invents legacy times', () => {
  const f = testClient(() => { throw Error('no reads expected'); });
  const mounted = mountNote(f.client, initial(), true);
  expect(document.querySelector('time')).toHaveAttribute('datetime', stamp);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  mounted.update({ ...initial(), noteUpdatedAt: null });
  expect(screen.getByText(/edit time not recorded/)).toBeVisible();
  expect(document.querySelector('time')).toBeNull();
});

it('preserves a clear intent when replacing after a conflict', async () => {
  let writes = 0;
  const f = testClient(request => request.method === 'GET'
    ? json({ ...initial(), note: 'Changed elsewhere', noteVersion: 2 })
    : ++writes === 1 ? json(apiError('conflict'),409)
      : json({ ...initial(), note: null, noteVersion: 3 }));
  mountNote(f.client);
  fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear note' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Replace with mine' }));
  await screen.findByRole('button', { name: 'Add a note' });
  expect(f.records.filter(r => r.method === 'PATCH').map(r => r.body)).toEqual([
    expect.objectContaining({ note: null, expectedNoteVersion: 1 }),
    expect.objectContaining({ note: null, expectedNoteVersion: 2 }),
  ]);
});
