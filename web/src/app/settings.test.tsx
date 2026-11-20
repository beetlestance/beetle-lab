// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ids, json, mount, readNamespace, testClient, deferred } from './test-fixtures.js';
import type { RequestRecord } from './test-fixtures.js';
import { settings, orgScope, workspaceScope } from '../features/settings/test-fixtures.js';
import { routes } from './routes.js';
import { queryKeys } from './queries.js';
import { fromUnit, toUnit, units } from '../features/settings/units.js';
import { parseRow, retentionRow } from '../features/settings/model.js';

afterEach(cleanup);
/** A workspace's settings page also reads its organization and workspace for the heading. */
const settingsOr = (data: unknown) => (request: RequestRecord) =>
  /\/(organizations|workspaces)\/[^/?]+$/.test(request.path) ? readNamespace(request) : json(data);
const settingsReads = (records: { method: string; path: string }[]) =>
  records.filter((record) => record.method === 'GET' && record.path.endsWith('/settings'));

describe('settings scope reads and values', () => {
  it.each([
    [routes.settings, { kind: 'installation' as const }, 'Settings for installation'],
    [routes.organizationSettings(ids.a), orgScope, 'Settings for this organization'],
    [routes.workspaceSettings(ids.a, ids.workspace), workspaceScope, 'Settings for Same workspace'],
  ])('renders typed settings at %s', async (path, scope, list) => {
    const api = testClient(settingsOr(settings(scope)));
    mount(api.client, path);
    const rows = await screen.findByRole('list', { name: list });
    expect(within(rows).getByRole('heading', { name: 'Longest run allowed' })).toBeVisible();
    expect(within(rows).getByRole('heading', { name: 'Remove finished runs older than' })).toBeVisible();
    expect(within(rows).getByLabelText('CPU per run')).toHaveValue('1');
    expect(screen.getByText('No unsaved changes.')).toBeVisible();
    expect(settingsReads(api.records)).toHaveLength(1);
    expect(settingsReads(api.records)[0]).toHaveProperty('signal');
  });
  it('labels where each value comes from and offers inherit only for values set here', async () => {
    const data = settings(workspaceScope);
    if ('overrides' in data) data.overrides.runDefaults = { budget: { pids: 50 } };
    data.effective.runDefaults.budget.pids = { value: 50, source: workspaceScope, allowedRange: { minimum: 1, maximum: 100 } };
    data.effective.runDefaults.budget.cpuMillis.source = orgScope;
    const api = testClient(settingsOr(data));
    mount(api.client, routes.workspaceSettings(ids.a, ids.workspace));
    const pids = (await screen.findByRole('heading', { name: 'Processes per run' })).closest('li')!;
    expect(within(pids).getByText('Set here')).toBeVisible();
    expect(within(pids).getByRole('button', { name: 'Inherit instead' })).toBeVisible();
    const cpu = screen.getByRole('heading', { name: 'CPU per run' }).closest('li')!;
    expect(within(cpu).getByText('Inherited from organization')).toBeVisible();
    expect(within(cpu).queryByRole('button', { name: 'Inherit instead' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Same workspace' })).toBeVisible();
    const sections = screen.getByRole('navigation', { name: 'Workspace sections' });
    expect(within(sections).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    const levels = screen.getByRole('navigation', { name: 'Settings level' });
    expect(within(levels).getByRole('link', { name: 'Organization' }))
      .toHaveAttribute('href', routes.organizationSettings(ids.a));
    expect(within(levels).getByRole('link', { name: 'Workspace' })).toHaveAttribute('aria-current', 'page');
  });
  it.each(['/organizations/bad/settings', `/organizations/${ids.a}/workspaces/bad/settings`])('rejects malformed settings IDs at %s before fetch', async path => {
    const api = testClient(() => json(settings())); mount(api.client, path);
    await screen.findByRole('heading', { name: 'Page not found' }); expect(api.records).toHaveLength(0);
  });
  it.each(['scope', 'source'])('rejects foreign %s replies via the actual client', async kind => {
    const data = settings(orgScope);
    if (kind === 'scope' && data.scope.kind === 'organization') data.scope.organizationId = ids.b;
    else data.effective.runDefaults.engineProfile.source = { kind: 'organization', organizationId: ids.b };
    const api = testClient(() => json(data)); mount(api.client, routes.organizationSettings(ids.a));
    expect(await screen.findByRole('alert')).toHaveTextContent('unreadable');
    expect(screen.queryByRole('list', { name: /Settings for/ })).not.toBeInTheDocument();
  });
  it('aborts a departed settings read and never displays its late reply', async () => {
    const reply = deferred<Response>();
    const api = testClient(request => request.path.endsWith('/settings') ? reply.promise : json({ scope: { kind: 'installation' }, items: [], nextCursor: null }));
    mount(api.client, routes.settings);
    await waitFor(() => expect(api.records).toHaveLength(1));
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Overview' }));
    await waitFor(() => expect(api.records[0]?.signal?.aborted).toBe(true));
    reply.resolve(json(settings()));
    await screen.findByRole('heading', { name: 'Create your first organization' });
    expect(screen.queryByRole('list', { name: /Settings for/ })).not.toBeInTheDocument();
  });
  it('normalizes UUID case while preserving URN identity', () => {
    expect(queryKeys.organizationSettings(ids.a)).toEqual(queryKeys.organizationSettings(ids.a.toUpperCase()));
    expect(queryKeys.organizationSettings(ids.a)).not.toEqual(queryKeys.organizationSettings(`urn:uuid:${ids.a}`));
  });
});
describe('canonical settings validation', () => {
  it.each(['1.2.3', '-1', '01', '1e3', ' 2', '.5', '0.0000000001'])('rejects %s in GB without truncation', value =>
    expect(fromUnit(value, units.gigabytes)).toBeUndefined());
  it('rejects counts past the safe integer range', () => expect(fromUnit('9007199254740992', units.procs)).toBeUndefined());
  it('converts display units exactly in both directions', () => {
    expect(fromUnit('1.5', units.gigabytes)).toBe(1_500_000_000);
    expect(fromUnit('0.001', units.cpus)).toBe(1);
    expect(fromUnit('0.0001', units.cpus)).toBeUndefined();
    expect(toUnit(3_600_000, units.minutes)).toBe('60');
    expect(toUnit(4_000_000_000, units.gigabytes)).toBe('4');
  });
  it('bounds retention days and keeps the policy’s other rules', () => {
    const data = settings(orgScope);
    data.effective.retention.value = { mode: 'enabled', ageDays: 7, completedRunCount: 20 };
    const row = retentionRow(data);
    expect(row.text).toBe('7');
    expect(row.note).toMatch(/keeps at most 20 finished runs/);
    expect(parseRow(data, row, { kind: 'set', text: '3' })).toEqual({ ok: true, value: { mode: 'enabled', completedRunCount: 20, ageDays: 3 } });
    expect(parseRow(data, row, { kind: 'set', text: '365001' }).ok).toBe(false);
    expect(parseRow(data, row, { kind: 'set', text: 'Off' })).toEqual({ ok: true, value: { mode: 'enabled', completedRunCount: 20 } });
    data.effective.retention.value = { mode: 'enabled', ageDays: 7 };
    expect(parseRow(data, retentionRow(data), { kind: 'set', text: '' })).toEqual({ ok: true, value: { mode: 'manual' } });
  });
});
