import { prepareColdJournalCopy } from '../../../agent/src/journal/cold-inspection/index.js';
import { scrubHistoricalCredentials } from '../../../app/src/adapters/outbound/sqlite/cold-inspection/index.js';
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RecoveryError } from './types.js';
import type { RecoveryIO } from './io.js';
import { directory, hashFile, regular, stable, syncDirectory } from './files.js';
import { checkDestination, nativeDatabase } from './database-custody.js';
import type { Destination } from './database-custody.js';
/** Stable logical snapshot while the caller holds both real offline leases. */
export async function copyDatabase(io: RecoveryIO, source: string, destination: string, maximum: number, kind: 'generic' | 'metadata' | 'journal' = 'generic') {
  await directory(io, dirname(source)); await directory(io, dirname(destination));
  const before = await io.issue(() => lstat(source, {bigint: true})); regular(before, maximum, false);
  const file = await io.acquireFile(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const captured: Destination = {path: destination, file, maximum, original: await io.issue(() => file.value.stat({bigint: true}))};
    await snapshot(io, source, captured); checkDestination(captured);
    if (stable(before) !== stable(await io.issue(() => lstat(source, {bigint: true})))) throw new RecoveryError('integrity');
    await normalize(io, captured, kind); checkDestination(captured);
    await io.issue(() => file.value.sync()); checkDestination(captured);
  } finally {await io.close(file);}
  await syncDirectory(io, dirname(destination)); return hashFile(io, destination, maximum);
}
async function snapshot(io: RecoveryIO, source: string, destination: Destination): Promise<void> {
  const original = io.acquireSync(() => new DatabaseSync(source, {readOnly: true, timeout: 100, defensive: true}), db => db.close());
  try {
    original.value.exec('PRAGMA query_only=ON; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
    const pages = boundedPages(original.value, destination.maximum); let invalid = false;
    await io.issue(() => nativeDatabase.backup(original.value, destination, {rate: 128, progress: frame => {
      if (!validProgress(frame.totalPages, frame.remainingPages, pages)) invalid = true;
    }}));
    if (invalid) throw new RecoveryError('integrity');
  } finally {await io.close(original);}
}
async function normalize(io: RecoveryIO, destination: Destination, kind: 'generic' | 'metadata' | 'journal'): Promise<void> {
  const copied = io.acquireSync(() => nativeDatabase.open(destination), db => db.close());
  try {
    // Owner is registered before the post-open check or any fallible SQL operation.
    checkDestination(destination);
    copied.value.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-2048; PRAGMA mmap_size=0;');
    if (kind === 'metadata') scrubHistoricalCredentials(copied.value);
    if (kind === 'journal') prepareColdJournalCopy(copied.value);
    if (copied.value.prepare('PRAGMA quick_check(1)').get()?.quick_check !== 'ok') throw new RecoveryError('integrity');
  } finally {await io.close(copied);}
}
function boundedPages(db: DatabaseSync, maximum: number): number {
  const pages = Number(db.prepare('PRAGMA page_count').get()?.page_count);
  const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size);
  if (!Number.isSafeInteger(pages) || !Number.isSafeInteger(pageSize) || !Number.isSafeInteger(pages * pageSize) || pages * pageSize > maximum) throw new RecoveryError('limit');
  return pages;
}
function validProgress(total: number, remaining: number, pages: number): boolean {
  return total === pages && Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= pages;
}
