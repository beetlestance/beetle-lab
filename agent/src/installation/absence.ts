import type { AttemptSnapshot } from '@beetle/contracts';
import { JournalError } from '../journal/index.js';
import type { Journal } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { CollectionIntent } from '../output-source/index.js';
import type { Entry } from './entry.js';
import type { DriveProgress } from './types.js';
import { InstallationError } from './types.js';
import type { InstallationOptions } from './types.js';
import { prepareStoppedObservation } from './stopped-history.js';

/** Only validated durable admission facts select this retirement path. */
export function absenceProgress(snapshot: AttemptSnapshot | null): DriveProgress | null {
  const admission = snapshot?.admission;
  if (admission?.state === 'rejected') return { kind: 'rejected', reason: admission.reason };
  if (admission?.state === 'released') return { kind: 'released', collection: 'failed' };
  return null;
}

/** Indexed debt and committed replay bypass current catalogue/staging availability. */
export async function recoverAbsence(input: {
  journal: Journal;
  entry: Entry;
  budget: Operation;
  intent: CollectionIntent | null;
  guard(entry: Entry, budget: Operation): void;
  retire(entry: Entry, progress: DriveProgress): Promise<void>;
}): Promise<DriveProgress | null> {
  if (input.entry.controller || input.intent) return null;
  const progress = absenceProgress(await input.journal.get(input.entry.key));
  input.guard(input.entry, input.budget);
  if (progress) await input.retire(input.entry, progress);
  return progress;
}

function requiresReleasedRetirement(entry: Entry, snapshot: AttemptSnapshot): boolean {
  return !entry.controller && snapshot.admission?.state === 'released' && snapshot.admission.disposition === 'settled';
}

/** Called only after retireNative. An empty recovered owner cannot retire an earlier runtime. */
export async function reconcileAbsence(
  options: InstallationOptions,
  entry: Entry,
  retireReleased: () => Promise<void>,
  operation?: Operation,
): Promise<boolean> {
  const { journal } = options;
  await entry.absenceAttempt?.catch(() => undefined);
  if (entry.cleanupFailed) throw new InstallationError('cleanup');
  if (await journal.readOutputAbsence(entry.key)) return true;
  const snapshot = await journal.get(entry.key);
  if (!absenceProgress(snapshot)) return false;
  if (requiresReleasedRetirement(entry, snapshot)) {
    entry.absenceNative ??= retireReleased();
    const original = entry.absenceNative;
    void original.catch(() => {
      if (entry.absenceNative === original) delete entry.absenceNative;
    });
    await original;
  }
  entry.absenceAttempt = closeWithHistory(options, entry, snapshot, operation);
  void entry.absenceAttempt.catch(() => undefined);
  if (!(await entry.absenceAttempt)) throw new InstallationError('cleanup');
  return true;
}

const historyOwners = new WeakMap<Journal, Promise<void>>();
async function closeWithHistory(
  options: InstallationOptions,
  entry: Entry,
  snapshot: AttemptSnapshot,
  operation?: Operation,
): ReturnType<Journal['closeOutputAbsence']> {
  const { journal } = options;
  if (!options.stoppedHistoryApproval || !snapshot.exitEvidence) return journal.closeOutputAbsence(entry.key);
  const active = historyOwners.get(journal);
  if (active) {
    if (operation) throw new JournalError('queue_full');
    // Shutdown waits for the original owner before trying the remaining drained entry.
    await active;
    return closeWithHistory(options, entry, snapshot);
  }
  let release!: () => void;
  historyOwners.set(
    journal,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    const history = await prepareStoppedObservation(options, entry, snapshot, operation);
    return await (history
      ? journal.closeOutputAbsence(entry.key, history.json)
      : journal.closeOutputAbsence(entry.key));
  } catch (error) {
    if (error instanceof InstallationError && error.reason === 'cleanup') entry.cleanupFailed = true;
    throw error;
  } finally {
    historyOwners.delete(journal);
    release();
  }
}
