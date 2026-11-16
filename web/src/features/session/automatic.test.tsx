// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { browser, calls, json, namespace, session, unpaired } from './test-fixtures.js';
afterEach(cleanup);
const automatic = {...session, accessMode: 'automatic' as const};
it('opens the local administrator automatically after an unauthenticated read, without a token form or resource queries before grant', async () => {
  let opened = false;
  const api = browser(record => {
    if (record.path.endsWith('/auth/session')) return unpaired();
    if (record.path.endsWith('/auth/local')) {opened = true; return json(automatic);}
    expect(opened).toBe(true); return namespace(record);
  }, '/', true);
  await screen.findByRole('table', {name: 'Organizations'});
  expect(screen.queryByLabelText('Startup token')).not.toBeInTheDocument();
  expect(calls(api.records, '/auth/pair')).toHaveLength(0); const request = calls(api.records, '/auth/local')[0]!;
  expect(request.method).toBe('POST'); expect(request.body).toEqual({}); expect(request.headers.get('X-Beetle-Local')).toBe('1');
  expect(request.credentials).toBe('same-origin'); expect(JSON.stringify({...localStorage})).not.toContain(session.csrfToken);
});
it('falls back to manual pairing only when the automatic exchange explicitly returns401', async () => {
  const api = browser(record => record.path.includes('/auth/') ? unpaired() : namespace(record), '/', true);
  await screen.findByLabelText('Startup token'); expect(calls(api.records, '/auth/local')).toHaveLength(1);
  expect(api.records.filter(record => !record.path.includes('/auth/'))).toHaveLength(0);
});
it('recovers a lost automatic exchange reply from the cookie once, without resending the grant', async () => {
  let reads = 0;
  const api = browser(record => {
    if (record.path.endsWith('/auth/session')) return ++reads === 1 ? unpaired() : json(automatic);
    if (record.path.endsWith('/auth/local')) throw new Error('reply lost after cookie application');
    return namespace(record);
  }, '/', true);
  await screen.findByRole('table', {name: 'Organizations'});
  expect(calls(api.records, '/auth/session')).toHaveLength(2); expect(calls(api.records, '/auth/local')).toHaveLength(1);
});
it('keeps logout signed out until explicit reconnect and never shows automatic users a token form', async () => {
  let signedOut = false;
  const api = browser(record => {
    if (record.path.endsWith('/auth/session')) return signedOut ? unpaired() : json(automatic);
    if (record.path.endsWith('/auth/logout')) {signedOut = true; return json({loggedOut: true});}
    if (record.path.endsWith('/auth/local')) {signedOut = false; return json(automatic);}
    return namespace(record);
  }, '/', true);
  await screen.findByRole('table', {name: 'Organizations'}); fireEvent.click(screen.getByRole('button', {name: 'Sign out'}));
  await screen.findByText(/This browser is signed out/); expect(calls(api.records, '/auth/local')).toHaveLength(0);
  expect(screen.queryByLabelText('Startup token')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Check session status'}));
  await screen.findByRole('table', {name: 'Organizations'}); await waitFor(() => expect(calls(api.records, '/auth/local')).toHaveLength(1));
});
it('reconciles a pending credential write on explicit retry after a503 without replaying resource mutations', async () => {
  let opened = false; let grants = 0;
  const api = browser(record => {
    if (record.path.endsWith('/auth/session')) return opened ? json(automatic) : json({code: 'storage_unavailable', message: 'Storage unavailable', retryable: true, fields: [], requestId: '00000000-0000-4000-8000-000000000001'}, 503);
    if (record.path.endsWith('/auth/local')) {
      if (++grants === 1) throw new Error('Persistence acknowledgement lost');
      opened = true; return json(automatic);
    }
    return namespace(record);
  }, '/', true);
  await screen.findByText(/Local access could not be confirmed/); expect(grants).toBe(1);
  expect(screen.queryByLabelText('Startup token')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: 'Check session status'}));
  await screen.findByRole('table', {name: 'Organizations'}); expect(grants).toBe(2);
  expect(api.records.filter(record => record.method === 'POST' && !record.path.includes('/auth/'))).toHaveLength(0);
});
it('identifies authenticated restored history as read-only', async () => {
  browser(record => record.path.endsWith('/auth/session') ? json({...automatic, readOnly: true}) : namespace(record), '/', true);
  await screen.findByRole('table', {name: 'Organizations'});
  expect(screen.getByText('Read-only restored history. Runs, settings and stored data cannot be changed.')).toBeVisible();
});
