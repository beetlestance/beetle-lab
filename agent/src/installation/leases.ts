import type { Entry, EntryLease } from './entry.js';
export type { EntryLease } from './entry.js';
import { InstallationError } from './types.js';

/** Reserve synchronously, before caller callbacks or the first foreign await. */
export function acquireLease(entry: Entry, reconciliation = false): EntryLease {
  if (entry.retiring && !reconciliation) throw new InstallationError('busy');
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; });
  const lease: EntryLease = { entry, done, finish: () => { entry.leases.delete(lease); finish(); } };
  entry.users++; entry.version++; entry.leases.add(lease); return lease;
}
export async function drainLeases(entry: Entry, caller?: EntryLease): Promise<void> {
  if (caller && (caller.entry !== entry || !entry.leases.has(caller))) throw new InstallationError('cleanup');
  await Promise.all([...entry.leases].filter(lease => lease !== caller).map(lease => lease.done));
}
