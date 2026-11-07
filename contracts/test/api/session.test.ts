import { expect, it } from 'vitest';
import { apiOperations, validateApi } from '../../src/api/index.js';

it('accepts bounded bootstrap credentials and never an ambient session identifier', () => {
  expect(validateApi('PairBrowserRequest', { bootstrapToken: 'a'.repeat(43) }).ok).toBe(true);
  for (const token of ['', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '=', 'a'.repeat(42) + '\n']) {
    expect(validateApi('PairBrowserRequest', { bootstrapToken: token }).ok).toBe(false);
  }
  expect(validateApi('PairBrowserRequest', { bootstrapToken: 'a'.repeat(43), sessionId: 'private' }).ok).toBe(false);
});

it('exposes only installation-wide local authority, fixed expiry and CSRF on session replies', () => {
  const session = { scope: 'local-admin', csrfToken: 'a'.repeat(43), expiresAt: '2026-11-07T12:00:00.000Z' };
  expect(validateApi('BrowserSession', session).ok).toBe(true);
  for (const extra of [{ sessionId: 'private' }, { bootstrapToken: 'private' }, { role: 'owner' }]) {
    expect(validateApi('BrowserSession', { ...session, ...extra }).ok).toBe(false);
  }
  for (const expiry of ['2026-11-07', '2026-11-07T12:00:00+00:00', '2026-02-30T12:00:00.000Z']) {
    expect(validateApi('BrowserSession', { ...session, expiresAt: expiry }).ok).toBe(false);
  }
  expect(validateApi('BrowserSession', { ...session, scope: 'organization' }).ok).toBe(false);
});

it('requires explicit logout and describes auth operations without creating routes', () => {
  expect(validateApi('LogoutBrowserRequest', {}).ok).toBe(true);
  expect(validateApi('LogoutBrowserRequest', { csrfToken: 'a'.repeat(43) }).ok).toBe(false);
  expect(validateApi('LogoutBrowserReceipt', { loggedOut: true }).ok).toBe(true);
  expect(validateApi('LogoutBrowserReceipt', { loggedOut: false }).ok).toBe(false);
  expect(apiOperations.filter(operation => operation.path.startsWith('/api/v2/auth/'))
    .map(operation => [operation.name, operation.method, operation.successStatus])).toEqual([
      ['pairBrowserSession', 'POST', 200], ['getBrowserSession', 'GET', 200], ['logoutBrowserSession', 'POST', 200],
    ]);
});
