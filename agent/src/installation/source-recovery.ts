import { createHash } from 'node:crypto';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { CollectionIntent } from '../output-source/index.js';
import { receiptForOutputSource } from '../output-source/index.js';
import { JournalError } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { Entry } from './entry.js';
import { InstallationError } from './types.js';
import type { DriveProgress, InstallationOptions } from './types.js';

type SourceRecovery = { readonly intent: CollectionIntent | null } | { readonly progress: DriveProgress };
interface RecoveryContext {
  readonly options: Pick<InstallationOptions, 'journal'>;
  guard(entry: Entry, budget: Operation): void;
  retire(entry: Entry): Promise<void>;
}
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A recreated owner reconciles durable custody before consulting current installs. */
export async function recoverSource(context: RecoveryContext, entry: Entry, budget: Operation): Promise<SourceRecovery> {
  if (entry.controller) return { intent: null };
  const { journal } = context.options;
  try {
    const source = await journal.readOutputSource(entry.key); context.guard(entry, budget);
    if (source) {
      const receipt = receiptForOutputSource(source, digest);
      const released = await journal.releaseOutputSource(receipt); context.guard(entry, budget);
      if (released.status !== 'released'
        || encodeCanonicalJson(released.releaseEvidence, 8192) !== encodeCanonicalJson(source.release, 8192)) throw new InstallationError('journal');
      await context.retire(entry); return { progress: { kind: 'released', collection: 'finished' } };
    }
    const intent = await journal.readOutputCollection(entry.key); context.guard(entry, budget);
    return { intent };
  } catch (error) {
    context.guard(entry, budget);
    if (error instanceof JournalError && error.code === 'queue_full') return { progress: { kind: 'deferred', reason: 'journal_busy' } };
    throw error;
  }
}
