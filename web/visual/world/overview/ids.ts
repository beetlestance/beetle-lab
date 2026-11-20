// Ids and clock helpers for the overview family. Short ids on screen are the first four hex digits.
import { NOW } from '../../harness.js';

export const NOW_MS = Date.parse(NOW);
export const HOUR = 3_600_000;

/** A UUID whose first four hex digits are `head` (what the screens show as the run's short id). */
export function uuid(head: string, n: number): string {
  return `${head}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const iso = (ms: number) => new Date(ms).toISOString();
/** An ISO time on the fixed day (2026-11-07, UTC) at hh:mm. */
export const today = (hhmm: string) => `2026-11-07T${hhmm}:00.000Z`;

export const suiteIds = {
  steady: uuid('5eed', 101),
  smoke: uuid('5a0c', 102),
  ramp: uuid('7a3b', 103),
  checkoutFlow: uuid('c0f1', 104),
  soak: uuid('50a4', 105),
} as const;

export const suiteNames: Record<string, string> = {
  [suiteIds.steady]: 'steady-1.2k',
  [suiteIds.smoke]: 'smoke-catalog',
  [suiteIds.ramp]: 'ramp-until-break',
  [suiteIds.checkoutFlow]: 'checkout-flow',
  [suiteIds.soak]: 'soak-30m',
};

/** Workspaces besides Checkout (which `signedIn` provides). */
export const workspaceIds = {
  checkout: '00000000-0000-4000-8000-000000000002',
  search: uuid('5ea0', 201),
  payments: uuid('9a70', 202),
} as const;

export const attemptId = '00000000-0000-4000-8000-000000000006';
export const revisionId = '00000000-0000-4000-8000-000000000004';
