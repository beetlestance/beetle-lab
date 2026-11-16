import type { Journal } from '../journal/index.js';
import type { AttemptSnapshot } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import { absenceProgress } from './absence.js';
import { allocation } from './recovery.js';
import { identity } from './entry.js';
import type { Entry } from './entry.js';

function reconciling(entry: Entry): boolean { return entry.retiring || entry.sourceCheck || entry.sourceReceipt !== undefined; }
function provisional(entry: Entry): boolean {
  return !reconciling(entry) && entry.users === 0 && !entry.active && !entry.controller && !entry.preparation
    && !entry.cancellation && !entry.closing && !entry.cleanupFailed && !entry.timeout && !entry.watch;
}
function observable(entry: Entry): boolean {
  return !reconciling(entry) && entry.users === 0 && entry.leases.size === 0 && !entry.active && !entry.cleanupFailed;
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
function unchanged(entries: Map<string, Entry>, entry: Entry, version: number): boolean {
  return entries.get(identity(entry.key)) === entry && entry.version === version && observable(entry);
}
/** Original public operations retain this probe; uncertain journal observations keep ownership. */
export async function releaseProvisional(input: { journal: Journal; entries: Map<string, Entry>; entry: Entry;
  retire(): Promise<void> }): Promise<void> {
  const { journal, entries, entry } = input;
  const key = identity(entry.key);
  const version = entry.version;
  if (!unchanged(entries, entry, version)) return;
  try {
    const current = await allocation(journal, entry.key);
    // A lane or cancellation may have started and finished while the read was outstanding.
    if (!unchanged(entries, entry, version)) return;
    if (current?.status === 'charged') return;
    const snapshot = await knownSnapshot(journal, entry);
    if (!unchanged(entries, entry, version)) return;
    const progress = absenceProgress(snapshot);
    if (!progress) {
      if (provisional(entry)) entries.delete(key);
      return;
    }
    entry.retirementProgress ??= progress;
  } catch {
    // Failure cannot prove absence of a durable charge. Retain the owner for shutdown/reconciliation.
    return;
  }
  await input.retire();
}
async function knownSnapshot(journal: Journal, entry: Entry): Promise<AttemptSnapshot | null> {
  try { return await journal.get(entry.key); }
  catch (error) {
    if (error instanceof JournalError && error.code === 'not_found') return null;
    throw error;
  }
}
