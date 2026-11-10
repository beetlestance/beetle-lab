import type { Journal } from '../journal/index.js';
import { allocation } from './recovery.js';
import { identity } from './entry.js';
import type { Entry } from './entry.js';

function reconciling(entry: Entry): boolean { return entry.retiring || entry.sourceCheck || entry.sourceReceipt !== undefined; }
function provisional(entry: Entry): boolean {
  return !reconciling(entry) && entry.users === 0 && !entry.active && !entry.controller && !entry.preparation
    && !entry.cancellation && !entry.closing && !entry.cleanupFailed && !entry.timeout && !entry.watch;
}
/** Only newly created metadata owners qualify; existing native custody stays on retirement. */
export function closedSourceCandidate(entry: Entry): boolean {
  const native = entry.controller || entry.preparation || entry.cancellation || entry.closing
    || entry.watch || entry.timeout || entry.plan;
  return Boolean(entry.sourceReceipt) && !reconcilingNative(entry) && !native;
}
function reconcilingNative(entry: Entry): boolean {
  return entry.retiring || entry.users !== 0 || entry.leases.size !== 0 || Boolean(entry.active)
    || entry.cleanupFailed || entry.fresh || entry.prepared;
}
/** Original public operations retain this probe; uncertain journal observations keep ownership. */
export async function releaseProvisional(journal: Journal, entries: Map<string, Entry>, entry: Entry): Promise<void> {
  const key = identity(entry.key);
  if (entries.get(key) !== entry || !provisional(entry)) return;
  const version = entry.version;
  try {
    const current = await allocation(journal, entry.key);
    // A lane or cancellation may have started and finished while the read was outstanding.
    if (entry.version !== version || !provisional(entry)) return;
    if (current?.status === 'charged') return;
    if (entries.get(key) === entry) entries.delete(key);
  } catch {
    // Failure cannot prove absence of a durable charge. Retain the owner for shutdown/reconciliation.
  }
}
