// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiError, browser, calls, deferred, json, namespace, org, pair, session, token, unpaired } from './test-fixtures.js';
import { BrowserSessionGate } from './session.js';
import { ids } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';

afterEach(cleanup);
describe('session lifetime and uncertain writes', () => {
  it.each([200, 401])('unmounts App immediately and sends logout with its own live signal, status %s', async status => {
    const logout = deferred<Response>();
    const resources = deferred<Response>();
    const api = browser(record => {
      if (record.path.endsWith('/auth/session')) return json(session);
      if (record.path.endsWith('/auth/logout')) return logout.promise;
      return resources.promise;
    });
    await waitFor(() => expect(api.records.some(record => record.path.includes('/organizations?'))).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(calls(api.records, '/auth/logout')).toHaveLength(1));
    const oldRead = api.records.find(record => record.path.includes('/organizations?'));
    expect(oldRead?.signal?.aborted).toBe(true);
    const request = calls(api.records, '/auth/logout')[0];
    expect(request?.signal?.aborted).toBe(false);
    expect(request?.headers.get('X-Beetle-CSRF')).toBe(session.csrfToken);
    expect(request?.body).toEqual({});
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    await act(async () => logout.resolve(status === 401 ? unpaired() : json({ loggedOut: true })));
    expect(await screen.findByLabelText('Startup token')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('signed out');
    await act(async () => resources.resolve(json({ scope: { kind: 'installation' }, items: [org()], nextCursor: null })));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(calls(api.records, '/auth/logout')).toHaveLength(1);
  });
  it.each(['transport', 'response', 'server', 'denied'] as const)('keeps %s logout unconfirmed until an explicit session read', async kind => {
    const api = browser(record => {
      if (record.path.endsWith('/auth/session')) return json(session);
      if (record.path.endsWith('/auth/logout')) {
        if (kind === 'transport') throw new Error('lost logout response');
        if (kind === 'response') return new Response('Unreadable', { status: 200 });
        return json(apiError(kind === 'server' ? 'internal_error' : 'forbidden'), kind === 'server' ? 500 : 403);
      }
      return namespace(record);
    });
    await screen.findByRole('table', { name: 'Organizations' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-out could not be confirmed');
    expect(screen.getByRole('alert')).toHaveTextContent('session may still be active');
    expect(calls(api.records, '/auth/session')).toHaveLength(1);
    expect(calls(api.records, '/auth/logout')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Check session status' }));
    await screen.findByRole('table', { name: 'Organizations' });
    expect(calls(api.records, '/auth/session')).toHaveLength(2);
    expect(calls(api.records, '/auth/logout')).toHaveLength(1);
    expect(api.records.filter(record => record.path.includes('/organizations?'))).toHaveLength(2);
  });
  it('fences a mutation 401, aborts all old requests, discards drafts/cache, and never replays the write', async () => {
    let reads = 0;
    const write = deferred<Response>();
    const api = browser(record => {
      if (record.path.endsWith('/auth/session') || record.path.endsWith('/auth/pair')) return json(session);
      if (record.method === 'POST') return write.promise;
      if (record.path.includes('/organizations?')) {
        reads++;
        return json({ scope: { kind: 'installation' }, items: [{ ...org(), name: reads === 1 ? 'Old cached name' : 'Fresh name' }], nextCursor: null });
      }
      return namespace(record);
    });
    await screen.findByRole('link', { name: 'Old cached name' });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Unacknowledged change' } });
    fireEvent.change(screen.getByLabelText('Organization slug'), { target: { value: 'unacknowledged' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.records.filter(record => record.method === 'POST')).toHaveLength(1));
    await act(async () => write.resolve(unpaired()));
    await screen.findByLabelText('Startup token');
    expect(screen.getByRole('status')).toHaveTextContent('may have committed; its outcome is unknown');
    expect(api.records.filter(record => !record.path.includes('/auth/')).every(record => record.signal?.aborted)).toBe(true);
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
    await pair();
    await screen.findByRole('link', { name: 'Fresh name' });
    expect(screen.queryByRole('link', { name: 'Old cached name' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByLabelText('Organization name')).toHaveValue('');
    expect(api.records.filter(record => record.method === 'POST' && !record.path.includes('/auth/'))).toHaveLength(1);
    expect(calls(api.records, '/auth/session')).toHaveLength(1);
  });
  it('aborts parallel reads on resource 401 and fences a late old resource response after fresh pairing', async () => {
    const oldWorkspace = deferred<Response>();
    const rejection = deferred<Response>();
    let paired = false;
    const api = browser(record => {
      if (record.path.endsWith('/auth/session')) return json(session);
      if (record.path.endsWith('/auth/pair')) { paired = true; return json({ ...session, csrfToken: 'd'.repeat(43) }); }
      if (paired) return namespace(record);
      if (record.method === 'POST') return rejection.promise;
      return record.path.includes('/workspaces?') ? oldWorkspace.promise : namespace(record);
    }, routes.organization(ids.a));
    await waitFor(() => expect(api.records.filter(record => !record.path.includes('/auth/'))).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Create workspace' }));
    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Possibly committed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.records.some(record => record.method === 'POST')).toBe(true));
    await act(async () => rejection.resolve(unpaired()));
    await screen.findByLabelText('Startup token');
    const old = api.records.find(record => record.path.includes('/workspaces?'));
    expect(old?.signal?.aborted).toBe(true);
    await pair();
    await screen.findByRole('button', { name: 'Create workspace' });
    await act(async () => oldWorkspace.resolve(json(apiError('unpaired'), 401)));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(api.records.at(-1)?.headers.get('X-Beetle-CSRF')).toBe('d'.repeat(43));
  });
  it.each(['read', 'pair', 'recovery', 'resource', 'logout'] as const)('aborts %s on unmount and ignores its late reply after a fresh mount', async phase => {
    const pending = deferred<Response>();
    let readCount = 0;
    const pairingPhase = ['pair', 'recovery'].includes(phase);
    const api = browser(record => {
      if (record.path.endsWith('/auth/session')) {
        readCount++;
        if (phase === 'read' || (phase === 'recovery' && readCount > 1)) return pending.promise;
        return pairingPhase ? unpaired() : json(session);
      }
      if (record.path.endsWith('/auth/pair')) {
        if (phase === 'recovery') throw new Error('lost pair');
        return pending.promise;
      }
      if (record.path.endsWith('/auth/logout') || phase === 'resource') return pending.promise;
      return namespace(record);
    });
    if (pairingPhase) await pair();
    if (phase === 'logout') fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    const suffix = { read: '/auth/session', pair: '/auth/pair', recovery: '/auth/session',
      resource: '/organizations?limit=100', logout: '/auth/logout' }[phase];
    await waitFor(() => expect(calls(api.records, suffix)).toHaveLength(phase === 'recovery' ? 2 : 1));
    const retained = calls(api.records, suffix).at(-1);
    api.unmount();
    expect(retained?.signal?.aborted).toBe(true);
    const fresh = browser(() => unpaired());
    await screen.findByLabelText('Startup token');
    await act(async () => pending.resolve(json(session)));
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(fresh.records).toHaveLength(1);
  });
  it('fences late session verification after a newer read and pairing in the same gate', async () => {
    const old = deferred<Response>();
    let reads = 0;
    const gate = new BrowserSessionGate({ baseUrl: 'http://localhost', fetch: async input => {
      if (String(input).endsWith('/auth/pair')) return json({ ...session, csrfToken: 'e'.repeat(43) });
      return ++reads === 1 ? old.promise : unpaired();
    } });
    gate.start();
    await waitFor(() => expect(reads).toBe(1));
    gate.check();
    await waitFor(() => expect(gate.getSnapshot().kind).toBe('unpaired'));
    gate.pair(token);
    await waitFor(() => expect(gate.getSnapshot().kind).toBe('paired'));
    const fresh = gate.getSnapshot();
    await act(async () => old.resolve(json(session)));
    expect(gate.getSnapshot()).toBe(fresh);
    gate.stop();
  });
});
