import { createHash } from 'node:crypto';
import { verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Owned, SourceEnvelope } from '@beetle/contracts/output-source';
import type { Scope } from '../admission/index.js';
import { receiptForOutputSource } from '../output-source/index.js';
import type { PrivateSource } from '../output-source/index.js';
import type { OutputSourceReaderOptions } from './index.js';
import type { Budget } from './budget.js';
import { OutputTransferError } from './errors.js';

const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
function matches(value: Readonly<Scope>, key: Readonly<Scope>): boolean {
  return (['organizationId', 'workspaceId', 'attemptId', 'generation'] as const).every(field => value[field] === key[field]);
}
function proveSource(source: PrivateSource, key: Readonly<Scope>, authority: string): void {
  try {
    const receipt = receiptForOutputSource(source, digest);
    if (receipt.journalAuthority !== authority || !matches(receipt.key, key)) throw new Error();
  } catch { throw new OutputTransferError('unavailable'); }
}
function publicSource(source: PrivateSource,
  closure: NonNullable<Awaited<ReturnType<OutputSourceReaderOptions['journal']['readOutputDelivery']>>>): Owned<SourceEnvelope> {
  try {
    return verifySourceEnvelope({ version: 1, manifest: source.manifest, sourceDigest: source.sourceDigest, closure }, digest);
  } catch { throw new OutputTransferError('unavailable'); }
}

export async function readSource(journal: OutputSourceReaderOptions['journal'], key: Readonly<Scope>, budget: Budget)
  : Promise<{ source: PrivateSource; envelope: Owned<SourceEnvelope> }> {
  budget.check(); const authority = await journal.journalAuthority(); budget.check();
  const source = await journal.readOutputSource(key); budget.check();
  if (source === null) {
    const snapshot = await journal.get(key); budget.check();
    if (!matches(snapshot, key)) throw new OutputTransferError('unavailable');
    const terminal = snapshot.admission?.state === 'released' || snapshot.admission?.state === 'rejected';
    throw new OutputTransferError(terminal ? 'unavailable' : 'pending');
  }
  proveSource(source, key, authority);
  const closure = await journal.readOutputDelivery(key); budget.check();
  if (closure === null) throw new OutputTransferError('pending');
  return { source, envelope: publicSource(source, closure) };
}
