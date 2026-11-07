// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError, deferred, ids, json, mount, org, readNamespace, testClient, workspace } from './test-fixtures.js';
import { routes } from './routes.js';

afterEach(cleanup);
describe('honest data and error states', () => {
  it('shows loading followed by an empty list without creating example data', async () => {
    const reply = deferred<Response>();
    const api = testClient(() => reply.promise);
    mount(api.client);
    expect(await screen.findByRole('status')).toHaveTextContent('Loading');
    await act(async () => reply.resolve(json({ scope: { kind: 'installation' }, items: [], nextCursor: null })));
    expect(await screen.findByRole('heading', { name: 'No organizations yet' })).toBeVisible();
    expect(api.records).toHaveLength(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
  it('surfaces unavailable transport without automatic retries and allows a read retry', async () => {
    let available = false;
    const api = testClient(request => {
      if (!available) throw new Error('PRIVATE synthetic exception must never be displayed');
      return readNamespace(request);
    });
    mount(api.client);
    expect(await screen.findByRole('alert')).toHaveTextContent('The service is unavailable.');
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
    expect(api.records).toHaveLength(1);
    available = true;
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(await screen.findAllByRole('link', { name: 'Same organization' })).toHaveLength(2);
    expect(api.records).toHaveLength(2);
  });
  it('shows the unpaired response and no authenticated data fallback', async () => {
    const api = testClient(() => json(apiError('unpaired'), 401));
    mount(api.client, routes.organization(ids.a));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pairing required');
    expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument();
    expect(api.records).toHaveLength(1);
  });
  it('rejects a wrong-organization workspace response through the real client', async () => {
    const api = testClient(request => request.path.includes('/workspaces?')
      ? json({ scope: workspace(ids.b).scope, items: [workspace(ids.b)], nextCursor: null }) : readNamespace(request));
    mount(api.client, routes.organization(ids.a));
    expect(await screen.findByRole('alert')).toHaveTextContent('unreadable response');
    expect(screen.queryByRole('link', { name: 'Same workspace' })).not.toBeInTheDocument();
  });
  it('rejects an oversized page rather than showing unbounded rows', async () => {
    const api = testClient(() => json({ scope: { kind: 'installation' }, items: Array.from({ length: 101 }, () => org()), nextCursor: null }));
    mount(api.client);
    expect(await screen.findByRole('alert')).toHaveTextContent('unreadable response');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('persists only the browser theme preference', async () => {
    localStorage.clear();
    const api = testClient(readNamespace);
    mount(api.client);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'dark'));
    expect(localStorage.getItem('beetle.theme')).toBe('dark');
    expect(localStorage.length).toBe(1);
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
