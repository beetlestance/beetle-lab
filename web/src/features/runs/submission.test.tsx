// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { validateApi } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { queryKeys } from '../../app/queries.js';
import { ids, json, testClient, settings, revision, mountLauncher, receipt, deferred, apiError, runId } from './test-fixtures.js';
afterEach(cleanup);
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Run saved revision' }));
  return screen.findByRole('button', { name: 'Submit run' });
}
function reply(body: unknown) {
  const checked = validateApi('CreateRunRequest', body);
  if (!checked.ok) throw new Error('Invalid synthetic request');
  return json(receipt(checked.value), 202);
}
it('does nothing until opened, loads actual defaults and submits selected saved revision and explicit policy', async () => {
  const fixture = testClient(request => request.method === 'POST' ? reply(request.body) : json(settings()));
  mountLauncher(fixture.client); expect(fixture.records).toHaveLength(0);
  const submit = await open();
  expect(document.activeElement).toBe(screen.getByLabelText('Engine profile'));
  fireEvent.change(screen.getByLabelText('CPU (millicores)'), { target: { value: '1500' } });
  fireEvent.change(screen.getByLabelText('Engine profile'), { target: { value: 'k6-small' } });
  fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'isolated' } });
  fireEvent.click(screen.getByLabelText('Prefer idle capacity')); fireEvent.click(submit);
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(routes.run(ids.a, ids.workspace, runId)));
  const writes = fixture.records.filter(record => record.method === 'POST'); expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toMatchObject({ scope: revision().scope, revisionId: revision().id, engineProfile: 'k6-small',
    budget: { cpuMillis: 1500 }, executionPolicy: { mode: 'isolated', preferIdle: true } });
  expect(writes[0]?.body).not.toHaveProperty('config');
});
it('blocks double clicks while one captured original is in flight', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.method === 'POST' ? late.promise : json(settings()));
  mountLauncher(fixture.client); const submit = await open();
  fireEvent.click(submit); fireEvent.click(submit);
  await waitFor(() => expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(1));
  await act(async () => late.resolve(reply(fixture.records.find(record => record.method === 'POST')?.body)));
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(1);
});
it.each(['transport', '503', 'interrupted'] as const)('preserves byte-equivalent original on %s despite changed defaults', async failure => {
  let writes = 0; const late = deferred<Response>();
  const fixture = testClient(request => {
    if (request.method !== 'POST') return json(settings());
    if (++writes > 1) return reply(request.body);
    if (failure === 'transport') throw new Error('synthetic lost response');
    return failure === '503' ? json(apiError('storage_unavailable'), 503) : late.promise;
  });
  const view = mountLauncher(fixture.client); fireEvent.click(await open());
  if (failure === 'interrupted') {
    fireEvent.click(await screen.findByRole('button', { name: 'Interrupt request' }));
    await act(async () => late.resolve(reply(fixture.records.find(record => record.method === 'POST')?.body)));
  }
  const replay = await screen.findByRole('button', { name: 'Replay original request' });
  const changed = settings(); changed.version = 2; changed.effective.runDefaults.engineProfile.value = 'k6-small';
  changed.effective.runDefaults.budget.cpuMillis.value = 500;
  await act(async () => view.queryClient.setQueryData(queryKeys.workspaceSettings(ids.a, ids.workspace), changed));
  expect(screen.getByLabelText('CPU (millicores)')).toHaveValue('1000');
  expect(screen.getByLabelText('Engine profile')).toHaveValue('k6');
  expect(screen.getByRole('button', { name: 'Submit run' })).toBeDisabled();
  fireEvent.click(replay);
  await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(`/runs/${runId}`));
  const sent = fixture.records.filter(record => record.method === 'POST'); expect(sent).toHaveLength(2);
  expect(JSON.stringify(sent[1]?.body)).toBe(JSON.stringify(sent[0]?.body));
});
it.each([401, 404, 409])('shows safe known HTTP %s failure without replaying', async status => {
  const fixture = testClient(request => request.method === 'POST'
    ? json(apiError(status === 401 ? 'unpaired' : status === 409 ? 'conflict' : 'not_found'), status) : json(settings()));
  mountLauncher(fixture.client); fireEvent.click(await open());
  await screen.findByRole('alert'); expect(screen.queryByText('synthetic_private_value')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Replay original request' })).not.toBeInTheDocument();
  expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(1);
});
it.each(['0', '1.2', '9007199254740992', '1e3', '2001', 'NaN', ' 2', '01'])('rejects invalid CPU %s before issuance and focuses the error', async value => {
  const fixture = testClient(() => json(settings())); mountLauncher(fixture.client); const submit = await open();
  fireEvent.change(screen.getByLabelText('CPU (millicores)'), { target: { value } }); fireEvent.click(submit);
  const alert = await screen.findByRole('alert'); expect(alert).toHaveFocus();
  expect(fixture.records.every(record => record.method === 'GET')).toBe(true);
});
it('aborts and fences a late accepted creation after route retirement', async () => {
  const late = deferred<Response>();
  const fixture = testClient(request => request.method === 'POST' ? late.promise : json(settings()));
  mountLauncher(fixture.client); fireEvent.click(await open());
  await waitFor(() => expect(fixture.records.filter(record => record.method === 'POST')).toHaveLength(1));
  fireEvent.click(screen.getByRole('button', { name: 'Leave form' }));
  const write = fixture.records.find(record => record.method === 'POST'); expect(write?.signal?.aborted).toBe(true);
  await act(async () => late.resolve(reply(write?.body)));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/retired');
});
it('aborts pending settings on unmount and preserves no hidden launcher request', async () => {
  const late = deferred<Response>(); const fixture = testClient(() => late.promise);
  const view = mountLauncher(fixture.client); fireEvent.click(screen.getByRole('button', { name: 'Run saved revision' }));
  await waitFor(() => expect(fixture.records).toHaveLength(1)); view.unmount();
  expect(fixture.records[0]?.signal?.aborted).toBe(true); await act(async () => late.resolve(json(settings())));
});
it('does not replace a newer cached detail with the original queued receipt', async () => {
  const fixture = testClient(request => request.method === 'POST' ? reply(request.body) : json(settings()));
  const view = mountLauncher(fixture.client);
  const key = queryKeys.run(ids.a, ids.workspace, runId);
  view.queryClient.setQueryData(key, { version: 9, state: 'finished' });
  fireEvent.click(await open()); await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(`/runs/${runId}`));
  expect(view.queryClient.getQueryData(key)).toEqual({ version: 9, state: 'finished' });
});
