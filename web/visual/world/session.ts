// Session and connection fixtures: error replies of the session gate and a signed-in shell
// whose reads can be switched off to show "Connection lost".
import type { Page } from '@playwright/test';
import type { Api, Json } from '../harness.js';
import { NOW } from '../harness.js';
import { fixture, signedIn } from './index.js';

/** Messages the contract pairs with each error code (common.schema.json ApiError). */
const messages = {
  unpaired: 'Pairing required',
  forbidden: 'Access denied',
  upgrade_pending: 'Paused for upgrade',
  conflict: 'Version or intent conflict',
  invalid_value: 'Invalid value',
  internal_error: 'Internal error',
} as const;
export type ErrorCode = keyof typeof messages;

/** A contract-valid error reply (SafeError shape) with its HTTP status. */
export function refusal(status: number, code: ErrorCode, extra: Record<string, Json> = {}) {
  return {
    status,
    body: {
      code,
      message: messages[code],
      retryable: false,
      requestId: '00000000-0000-4000-8000-000000000010',
      fields: [],
      ...extra,
    },
  };
}

/** A well-formed 43 character pairing token (the form only accepts exactly that). */
export const pairingToken = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

const HOUR = 3_600_000;
/** The organization overview (the home screen), with its 24 hourly buckets ending at NOW. */
function organizationOverview(): Json {
  const overview = fixture<Record<string, Json>>('organization-overview');
  const end = Date.parse(NOW);
  const activity = (overview.activity as { from: string; to: string }[]).map((bucket, index, all) => ({
    ...bucket,
    from: new Date(end - (all.length - index) * HOUR).toISOString(),
    to: new Date(end - (all.length - index - 1) * HOUR).toISOString(),
  }));
  return { ...overview, generatedAt: NOW, windowStart: new Date(end - 24 * HOUR).toISOString(), activity };
}

/** A session the gate accepts, and the reads the shell makes once it is open. */
export function openSession(api: Api): Api {
  return signedIn(api)
    .on('getOrganizationOverview', organizationOverview())
    .on('getBrowserSession', { ...fixture('browser-session'), expiresAt: '2026-11-08T23:40:00.000Z' })
    .on('logoutBrowserSession', { loggedOut: true });
}

/** Lets a test cut every API read except the session read, then restore them. */
export async function switchableConnection(page: Page, startDown = false) {
  const state = { down: startDown };
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (state.down && !path.startsWith('/api/v2/auth/')) return route.abort('connectionrefused');
    return route.fallback();
  });
  return state;
}
