// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ids, json, mount, testClient, deferred } from './test-fixtures.js';
import { settings, orgScope, workspaceScope } from '../features/settings/test-fixtures.js';
import { routes } from './routes.js';
import { queryKeys } from './queries.js';
import { integer, parseRetention } from '../features/settings/fields.js';

afterEach(cleanup);

describe('settings scope reads and values', () => {
  it.each([
    [routes.settings, { kind: 'installation' as const }],
    [routes.organizationSettings(ids.a), orgScope],
    [routes.workspaceSettings(ids.a, ids.workspace), workspaceScope],
  ])('renders typed settings at %s', async (path, scope) => {
    const api = testClient(() => json(settings(scope)));
    mount(api.client, path);
    expect(await screen.findByRole('heading', { name: 'Run defaults' })).toBeVisible();
    expect(screen.getByRole('table')).toHaveAccessibleName('Effective defaults and explicit overrides');
    expect(screen.getByText(/Saving a policy does not delete/)).toBeVisible();
    expect(api.records).toHaveLength(1);
    expect(api.records[0]?.signal).toBeDefined();
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
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('aborts a departed settings read and never displays its late reply', async () => {
    const reply = deferred<Response>();
    const api = testClient(request => request.path.endsWith('/settings') ? reply.promise : json({ scope: { kind: 'installation' }, items: [], nextCursor: null }));
    mount(api.client, routes.settings);
    await waitFor(() => expect(api.records).toHaveLength(1));
    fireEvent.click(screen.getByRole('link', { name: /Organizations/ }));
    await waitFor(() => expect(api.records[0]?.signal?.aborted).toBe(true));
    reply.resolve(json(settings()));
    await screen.findByRole('heading', { name: 'Organizations' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('normalizes UUID case while preserving URN identity', () => {
    expect(queryKeys.organizationSettings(ids.a)).toEqual(queryKeys.organizationSettings(ids.a.toUpperCase()));
    expect(queryKeys.organizationSettings(ids.a)).not.toEqual(queryKeys.organizationSettings(`urn:uuid:${ids.a}`));
  });
});
describe('canonical settings validation', () => {
  it.each(['1.2', '9007199254740992', '-1', '01', '1e3', ' 2'])('rejects integer %s without truncation', value => expect(() => integer(value)).toThrow());
  it('bounds retention rules and omits blank criteria', () => {
    expect(parseRetention({ mode: 'enabled', ageDays: '3', completedRunCount: '', storageBytes: '' })).toEqual({ mode: 'enabled', ageDays: 3 });
    expect(() => parseRetention({ mode: 'enabled', ageDays: '365001' })).toThrow();
    expect(() => parseRetention({ mode: 'enabled' })).toThrow();
    expect(parseRetention({ mode: 'manual', ageDays: '3' })).toEqual({ mode: 'manual' });
  });
});
