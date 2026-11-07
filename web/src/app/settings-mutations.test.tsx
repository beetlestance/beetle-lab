// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { apiError, ids, json, mount, readNamespace, testClient } from './test-fixtures.js';
import { settings, orgScope, workspaceScope } from '../features/settings/test-fixtures.js';
import { routes } from './routes.js';
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }

afterEach(cleanup);

describe('settings retained mutation intents', () => {
  it('edits a workspace actual override through its scoped PATCH endpoint', async () => {
    const data = settings(workspaceScope);
    if ('overrides' in data) data.overrides.runDefaults = { budget: { cpuMillis: 1200 } };
    data.effective.runDefaults.budget.cpuMillis = { value: 1200, source: workspaceScope, allowedRange: { minimum: 1, maximum: 2000 } };
    const api = testClient(() => json(data)); mount(api.client, routes.workspaceSettings(ids.a, ids.workspace));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CPU (millicores)' }));
    expect(screen.getByLabelText('CPU (millicores)')).toHaveValue('1200');
    change('CPU (millicores)', '1300'); save(); await screen.findByText('Changes saved.');
    expect(api.records.find(record => record.method === 'PATCH')).toMatchObject({
      path: `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/settings`,
      body: { scope: workspaceScope, patch: { runDefaults: { budget: { cpuMillis: 1300 } } } },
    });
  });
  it('keeps a known validation failure editable without replay or false success', async () => {
    const api = testClient(request => request.method === 'PATCH' ? json(apiError('invalid_value'), 422) : json(settings(orgScope)));
    mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit retention policy' })); save();
    await screen.findByText('Invalid value');
    expect(screen.queryByText('Changes saved.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry identical request' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
  it('starts inherited fields blank and saves only the selected override', async () => {
    const api = testClient(() => json(settings(orgScope)));
    mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CPU (millicores)' }));
    expect(screen.getByLabelText('CPU (millicores)')).toHaveValue('');
    expect(screen.getByLabelText('CPU (millicores)')).toHaveFocus();
    change('CPU (millicores)', '1500'); save();
    await screen.findByText('Changes saved.');
    expect(api.records.find(record => record.method === 'PATCH')?.body).toMatchObject({ expectedVersion: 1, schemaVersion: 2,
      scope: orgScope, patch: { runDefaults: { budget: { cpuMillis: 1500 } } } });
    expect(api.records.filter(record => record.method === 'GET')).toHaveLength(2);
  });
  it('sends explicit null for one inherit action', async () => {
    const api = testClient(() => json(settings(orgScope))); mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Inherit engine profile' })); save();
    await screen.findByText('Changes saved.');
    expect(api.records.find(record => record.method === 'PATCH')?.body?.patch).toEqual({ runDefaults: { engineProfile: null } });
  });
  it('replaces a complete installation group while leaving other groups omitted', async () => {
    const api = testClient(() => json(settings())); mount(api.client, routes.settings);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit pool limits' }));
    change('Free space reserve (bytes)', '2'); save(); await screen.findByText('Changes saved.');
    const patch = api.records.find(record => record.method === 'PATCH')?.body?.patch;
    expect(patch).toEqual({ pool: { cpuMillis: 2000, memoryBytes: 4096, pids: 100, outputBytes: 4096, concurrency: 2, storageBytes: 10000, freeSpaceReserveBytes: 2 } });
  });
  it('rejects overflow and empty enabled retention before transport', async () => {
    const api = testClient(() => json(settings(orgScope))); mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CPU (millicores)' }));
    change('CPU (millicores)', '9007199254740992'); save(); await screen.findByRole('alert');
    expect(api.records.filter(record => record.method === 'PATCH')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit retention policy' })); change('Retention mode', 'enabled'); save();
    await screen.findByRole('alert'); expect(api.records.filter(record => record.method === 'PATCH')).toHaveLength(0);
    change('Maximum age (days)', '4'); save(); await screen.findByText('Changes saved.');
    expect(api.records.find(record => record.method === 'PATCH')?.body?.patch).toEqual({ retention: { mode: 'enabled', ageDays: 4 } });
  });
  it.each(['transport', '503'])('replays %s with the identical request ID/version/body, editing starts a new intent', async failure => {
    const api = testClient(request => {
      if (request.method === 'PATCH') { if (failure === 'transport') throw new Error('Synthetic lost response'); return json(apiError('storage_unavailable'), 503); }
      return json(settings(orgScope));
    });
    mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CPU (millicores)' })); change('CPU (millicores)', '1500'); save();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry identical request' }));
    await waitFor(() => expect(api.records.filter(record => record.method === 'PATCH')).toHaveLength(2));
    await screen.findByRole('button', { name: 'Retry identical request' });
    let writes = api.records.filter(record => record.method === 'PATCH'); expect(writes[0]?.body).toEqual(writes[1]?.body);
    change('CPU (millicores)', '1600'); save();
    await waitFor(() => expect(api.records.filter(record => record.method === 'PATCH')).toHaveLength(3));
    writes = api.records.filter(record => record.method === 'PATCH'); expect(writes[2]?.body?.requestId).not.toEqual(writes[0]?.body?.requestId);
    expect(writes[2]?.body?.patch).toEqual({ runDefaults: { budget: { cpuMillis: 1600 } } });
  });
  it('preserves conflicts and requires reopen to adopt the refreshed version', async () => {
    let version = 1;
    const api = testClient(request => request.method === 'PATCH' ? json(apiError('conflict'), 409) : json(settings(orgScope, version)));
    mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CPU (millicores)' })); change('CPU (millicores)', '1500'); save();
    await screen.findByText('Version or intent conflict'); version = 2;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh latest version' }));
    await screen.findByText('organization · version 2'); expect(screen.getByLabelText('CPU (millicores)')).toHaveValue('1500');
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit CPU (millicores)' })); change('CPU (millicores)', '1600'); save();
    await waitFor(() => expect(api.records.filter(record => record.method === 'PATCH')).toHaveLength(2));
    expect(api.records.filter(record => record.method === 'PATCH')[1]?.body?.expectedVersion).toBe(2);
  });
  it('retains a settings draft across scope departure without leaking fields', async () => {
    const api = testClient(request => request.path.endsWith('/settings') ? json(settings(orgScope)) : readNamespace(request));
    mount(api.client, routes.organizationSettings(ids.a));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit CPU (millicores)' })); change('CPU (millicores)', '1500');
    fireEvent.click(screen.getByRole('button', { name: 'Switch organization B' }));
    expect(await screen.findByRole('link', { name: 'Return to draft' })).toHaveAttribute('href', routes.organizationSettings(ids.a));
    expect(screen.queryByLabelText('CPU (millicores)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Return to draft' }));
    expect(await screen.findByLabelText('CPU (millicores)')).toHaveValue('1500');
    expect(api.records.filter(record => record.method === 'PATCH')).toHaveLength(0);
  });
});
