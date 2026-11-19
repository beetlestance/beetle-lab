import { createHash } from 'node:crypto';
import { encodeCanonicalJson } from '@beetle/contracts';
import { capture, fields, integer, requireInput } from '@beetle/contracts/output-source/internal';
import { receiptForOutputSource } from '../output-source/index.js';
import type { PrivateSource } from '../output-source/index.js';
import type { Journal, OutputDeliveryClosure } from '../journal/index.js';
import type { Entry } from './entry.js';
import type { Operation } from '../backends/docker/index.js';
import { eligibleStoppedSource } from '../journal/stopped-history-value.js';
import { prepareStoppedObservation, withStoppedHistoryOwner } from './stopped-history.js';
import type { InstallationOptions } from './types.js';
import { InstallationError } from './types.js';

const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
const same = (left: unknown, right: unknown): boolean =>
  encodeCanonicalJson(left, 8192) === encodeCanonicalJson(right, 8192);
export function rememberSource(entry: Entry, source: PrivateSource): void {
  const receipt = receiptForOutputSource(source, digest);
  if (entry.sourceReceipt && !same(entry.sourceReceipt, receipt)) throw new InstallationError('journal');
  entry.sourceReceipt = receipt;
  entry.sourceRelease = source.release;
  entry.sourceCheck = false;
}
/** Validate this composition's exact receipt as well as the Journal's typed reply. */
function closure(input: unknown, entry: Entry): OutputDeliveryClosure {
  try {
    const value = fields(capture(input, 1024), 'version,receipt,finalAgentSeq');
    requireInput(value.version === 1);
    integer(value.finalAgentSeq);
    requireInput(same(value.receipt, entry.sourceReceipt));
    return value as unknown as OutputDeliveryClosure;
  } catch {
    throw new InstallationError('journal');
  }
}
export async function releaseStoredSource(journal: Journal, entry: Entry): Promise<boolean> {
  if (!entry.sourceReceipt) {
    const source = await journal.readOutputSource(entry.key);
    if (!source) return false;
    rememberSource(entry, source);
  }
  if (entry.sourceReleased) return true;
  const released = await journal.releaseOutputSource(entry.sourceReceipt!);
  if (released.status !== 'released' || !same(released.releaseEvidence, entry.sourceRelease))
    throw new InstallationError('journal');
  entry.sourceReleased = true;
  return true;
}
/** Earlier close originals settle before a read can prove absence and authorize replay. */
export async function reconcileDelivery(
  options: InstallationOptions,
  entry: Entry,
  operation?: Operation,
): Promise<void> {
  const { journal } = options;
  await entry.deliveryAttempt?.catch(() => undefined);
  if (entry.cleanupFailed) throw new InstallationError('cleanup');
  const stored = await journal.readOutputDelivery(entry.key);
  if (stored !== null) {
    closure(stored, entry);
    return;
  }
  entry.deliveryAttempt = closeWithHistory(options, entry, operation);
  void entry.deliveryAttempt.catch(() => undefined);
  closure(await entry.deliveryAttempt, entry);
}

async function closeWithHistory(options: InstallationOptions, entry: Entry, operation?: Operation) {
  const { journal } = options;
  const receipt = entry.sourceReceipt!;
  if (!options.stoppedHistoryApproval) return journal.closeOutputDelivery(receipt);
  const source = await journal.readOutputSource(entry.key);
  if (!source || !same(receipt, receiptForOutputSource(source, digest))) throw new InstallationError('journal');
  if (!eligibleStoppedSource(source.manifest.result)) return journal.closeOutputDelivery(receipt);
  return withStoppedHistoryOwner(journal, operation, async () => {
    const snapshot = await journal.get(entry.key);
    try {
      const observation = await prepareStoppedObservation(options, entry, snapshot, operation, source);
      return await (observation
        ? journal.closeOutputDelivery(receipt, observation.json)
        : journal.closeOutputDelivery(receipt));
    } catch (error) {
      if (error instanceof InstallationError && error.reason === 'cleanup') entry.cleanupFailed = true;
      throw error;
    }
  });
}

/** Absence never authorizes a late metadata caller to create a closure. */
export async function readClosedDelivery(journal: Journal, entry: Entry): Promise<boolean> {
  const stored = await journal.readOutputDelivery(entry.key);
  if (stored === null) return false;
  closure(stored, entry);
  return true;
}

export async function sourceCommitted(journal: Journal, entry: Entry): Promise<boolean> {
  if (entry.sourceReceipt) return true;
  entry.sourceCheck = true;
  const source = await journal.readOutputSource(entry.key);
  if (source) {
    rememberSource(entry, source);
    return true;
  }
  entry.sourceCheck = false;
  return false;
}
