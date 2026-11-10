import type { AttemptSnapshot } from '@beetle/contracts';
import type { Journal } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { CollectionIntent } from '../output-source/index.js';
import type { Entry } from './entry.js';
import type { DriveProgress } from './types.js';
import { InstallationError } from './types.js';

/** Only validated durable admission facts select this retirement path. */
export function absenceProgress(snapshot: AttemptSnapshot | null): DriveProgress | null {
  const admission = snapshot?.admission;
  if (admission?.state === 'rejected') return { kind: 'rejected', reason: admission.reason };
  if (admission?.state === 'released') return { kind: 'released', collection: 'failed' };
  return null;
}

/** Indexed debt and committed replay bypass current catalogue/staging availability. */
export async function recoverAbsence(input: { journal: Journal; entry: Entry; budget: Operation; intent: CollectionIntent | null;
  guard(entry: Entry, budget: Operation): void; retire(entry: Entry, progress: DriveProgress): Promise<void> }): Promise<DriveProgress | null> {
  if (input.entry.controller || input.intent) return null;
  const progress = absenceProgress(await input.journal.get(input.entry.key));
  input.guard(input.entry, input.budget);
  if (progress) await input.retire(input.entry, progress);
  return progress;
}

/** Called only after retireNative. An empty recovered owner cannot retire an earlier runtime. */
export async function reconcileAbsence(journal: Journal, entry: Entry, retireReleased: () => Promise<void>): Promise<boolean> {
  await entry.absenceAttempt?.catch(() => undefined);
  if (await journal.readOutputAbsence(entry.key)) return true;
  const snapshot = await journal.get(entry.key);
  if (!absenceProgress(snapshot)) return false;
  if (snapshot.admission?.state === 'released' && snapshot.admission.disposition === 'settled' && !entry.controller) {
    entry.absenceNative ??= retireReleased();
    const original = entry.absenceNative;
    void original.catch(() => { if (entry.absenceNative === original) delete entry.absenceNative; });
    await original;
  }
  entry.absenceAttempt = journal.closeOutputAbsence(entry.key);
  void entry.absenceAttempt.catch(() => undefined);
  if (!await entry.absenceAttempt) throw new InstallationError('cleanup');
  return true;
}
