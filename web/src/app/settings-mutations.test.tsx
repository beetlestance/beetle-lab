// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiError, ids, json, mount, readNamespace, testClient } from './test-fixtures.js';
import { settings, orgScope, workspaceScope } from '../features/settings/test-fixtures.js';
import { routes } from './routes.js';

afterEach(cleanup);
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Save ${name}` }));
const patches = (records: { method: string; body?: unknown }[]) =>
  records.filter((record) => record.method === 'PATCH') as { body?: { requestId?: string; expectedVersion?: number; patch?: unknown } }[];
const row = (heading: string) => screen.getByRole('heading', { name: heading }).closest('li')!;

describe('settings save bar', () => {
  it('saves a workspace override through its scoped PATCH endpoint in display units', async () => {
    const data = settings(workspaceScope);
    if ('overrides' in data) data.overrides.runDefaults = { budget: { cpuMillis: 1200 } };
    data.effective.runDefaults.budget.cpuMillis = { value: 1200, source: workspaceScope, allowedRange: { minimum: 1, maximum: 2000 } };
    const api = testClient(() => json(data)); mount(api.client, routes.workspaceSettings(ids.a, ids.workspace));
    expect(await screen.findByLabelText('CPU per run')).toHaveValue('1.2');
    change('CPU per run', '1.3');
    expect(within(row('CPU per run')).getByText('Changed here, not saved yet')).toBeVisible();
    expect(screen.getByText('1 unsaved change in this workspace.')).toBeVisible();
    save('this workspace'); await screen.findByText('Changes saved.');
    expect(api.records.find(record => record.method === 'PATCH')).toMatchObject({
      path: `/api/v2/organizations/${ids.a}/workspaces/${ids.workspace}/settings`,
      body: { scope: workspaceScope, patch: { runDefaults: { budget: { cpuMillis: 1300 } } } },
    });
  });
  it('keeps a known validation failure editable without replay or false success', async () => {
    const api = testClient(request => request.method === 'PATCH' ? json(apiError('invalid_value'), 422) : json(settings(orgScope)));
    mount(api.client, routes.organizationSettings(ids.a));
    await screen.findByLabelText('Remove finished runs older than');
    change('Remove finished runs older than', '30'); save('this organization');
    await screen.findByText('Invalid value');
    expect(screen.queryByText('Changes saved.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry identical request' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save this organization' })).toBeEnabled();
  });
  it('shows inherited values and saves only the changed override', async () => {
    const api = testClient(() => json(settings(orgScope)));
    mount(api.client, routes.organizationSettings(ids.a));
    expect(await screen.findByLabelText('CPU per run')).toHaveValue('1');
    expect(within(row('CPU per run')).getByText('Inherited from installation')).toBeVisible();
    change('CPU per run', '1.5'); save('this organization');
    await screen.findByText('Changes saved.');
    expect(patches(api.records)[0]?.body).toMatchObject({ expectedVersion: 1, schemaVersion: 2,
      scope: orgScope, patch: { runDefaults: { budget: { cpuMillis: 1500 } } } });
    expect(api.records.filter(record => record.method === 'GET' && record.path.endsWith('/settings'))).toHaveLength(2);
  });
  it('sends explicit null for Inherit instead, and Undo drops the change', async () => {
    const data = settings(orgScope);
    if ('overrides' in data) data.overrides.runDefaults = { engineProfile: 'k6-small', budget: { pids: 20 } };
    data.effective.runDefaults.engineProfile = { value: 'k6-small', source: orgScope, allowedValues: ['k6', 'k6-small'] };
    data.effective.runDefaults.budget.pids = { value: 20, source: orgScope, allowedRange: { minimum: 1, maximum: 100 } };
    const api = testClient(() => json(data)); mount(api.client, routes.organizationSettings(ids.a));
    await screen.findByLabelText('Engine for new runs');
    fireEvent.click(within(row('Processes per run')).getByRole('button', { name: 'Inherit instead' }));
    fireEvent.click(within(row('Processes per run')).getByRole('button', { name: 'Undo' }));
    fireEvent.click(within(row('Engine for new runs')).getByRole('button', { name: 'Inherit instead' }));
    expect(within(row('Engine for new runs')).getByText('Will inherit, not saved yet')).toBeVisible();
    save('this organization'); await screen.findByText('Changes saved.');
    expect(patches(api.records)[0]?.body?.patch).toEqual({ runDefaults: { engineProfile: null } });
  });
  it('replaces a complete installation group while leaving other groups omitted', async () => {
    const api = testClient(request => request.path.endsWith('/status') ? json(apiError('storage_unavailable'), 503) : json(settings()));
    mount(api.client, routes.settings);
    fireEvent.click(await screen.findByRole('radio', { name: 'Shared capacity' }));
    change('Disk always left free', '0.000000002'); save('installation'); await screen.findByText('Changes saved.');
    expect(patches(api.records)[0]?.body?.patch).toEqual({ pool: { cpuMillis: 2000, memoryBytes: 4096, pids: 100, outputBytes: 4096, concurrency: 2, storageBytes: 10000, freeSpaceReserveBytes: 2 } });
    expect(screen.getByText('What the host reports could not be read.')).toBeVisible();
  });
  it('saves the administrator name as its own installation field', async () => {
    const api = testClient(() => json(settings()));
    mount(api.client, routes.settings);
    change(await screen.findByRole('heading', { name: 'Administrator name' }).then(() => 'Administrator name'), 'Meera');
    save('installation'); await screen.findByText('Changes saved.');
    expect(patches(api.records)[0]?.body?.patch).toEqual({ administratorName: 'Meera' });
  });
  it('rejects out-of-range and malformed values before transport', async () => {
    const api = testClient(() => json(settings(orgScope))); mount(api.client, routes.organizationSettings(ids.a));
    await screen.findByLabelText('CPU per run');
    change('CPU per run', '3');
    expect(screen.getByText('Enter 0.001 to 2 CPUs.')).toBeVisible();
    expect(within(row('CPU per run')).getByText('Not saved: fix this value first')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save this organization' })).toBeDisabled();
    change('CPU per run', '1'); change('Remove finished runs older than', 'soon');
    expect(screen.getByText('Enter 1 to 365000 days, or Off.')).toBeVisible();
    change('Remove finished runs older than', '4'); save('this organization'); await screen.findByText('Changes saved.');
    expect(patches(api.records)).toHaveLength(1);
    expect(patches(api.records)[0]?.body?.patch).toEqual({ runDefaults: { budget: { cpuMillis: 1000 } }, retention: { mode: 'enabled', ageDays: 4 } });
  });
  it.each(['transport', '503'])('replays %s with the identical request ID/version/body, editing starts a new intent', async failure => {
    const api = testClient(request => {
      if (request.method === 'PATCH') { if (failure === 'transport') throw new Error('Synthetic lost response'); return json(apiError('storage_unavailable'), 503); }
      return json(settings(orgScope));
    });
    mount(api.client, routes.organizationSettings(ids.a));
    await screen.findByLabelText('CPU per run'); change('CPU per run', '1.5'); save('this organization');
    expect(await screen.findByText('Beetle did not confirm the save.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save this organization' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry identical request' }));
    await waitFor(() => expect(patches(api.records)).toHaveLength(2));
    await screen.findByRole('button', { name: 'Retry identical request' });
    let writes = patches(api.records); expect(writes[0]?.body).toEqual(writes[1]?.body);
    change('CPU per run', '1.6'); save('this organization');
    await waitFor(() => expect(patches(api.records)).toHaveLength(3));
    writes = patches(api.records); expect(writes[2]?.body?.requestId).not.toEqual(writes[0]?.body?.requestId);
    expect(writes[2]?.body?.patch).toEqual({ runDefaults: { budget: { cpuMillis: 1600 } } });
  });
  it('opens Changed elsewhere on a conflict and saves the kept draft against the refreshed version', async () => {
    let version = 1;
    const api = testClient(request => request.method === 'PATCH' ? json(apiError('conflict'), 409) : json(settings(orgScope, version)));
    mount(api.client, routes.organizationSettings(ids.a));
    await screen.findByLabelText('CPU per run'); change('CPU per run', '1.5'); save('this organization');
    const dialog = await screen.findByRole('alertdialog', { name: 'Changed elsewhere' }); version = 2;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh latest version' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('CPU per run')).toHaveValue('1.5');
    await waitFor(() => expect(api.records.filter(record => record.method === 'GET' && record.path.endsWith('/settings'))).toHaveLength(2));
    save('this organization');
    await waitFor(() => expect(patches(api.records)).toHaveLength(2));
    expect(patches(api.records)[1]?.body?.expectedVersion).toBe(2);
  });
  it('keeps a draft when leaving the level and shows its count on the level tab', async () => {
    const api = testClient(request => request.path.endsWith('/settings') ? json(settings(orgScope)) : readNamespace(request));
    mount(api.client, routes.organizationSettings(ids.a));
    await screen.findByLabelText('CPU per run'); change('CPU per run', '1.5');
    expect(within(screen.getByRole('navigation', { name: 'Settings level' })).getByRole('link', { name: 'Organization 1' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Switch organization A' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Organization settings' }));
    expect(await screen.findByLabelText('CPU per run')).toHaveValue('1.5');
    expect(screen.getByText(/^1 unsaved change in /)).toBeVisible();
    expect(patches(api.records)).toHaveLength(0);
  });
});
