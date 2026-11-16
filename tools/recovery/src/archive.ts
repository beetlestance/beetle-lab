import { knownTree } from './known-tree.js';
import { join } from 'node:path';
import type { RecoveryEntry } from '@beetle/contracts/recovery';
import { inspectHistoricalRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import type { RecoveryIO } from './io.js';
import type { RecoveryLimits } from './types.js';
import { limits, RecoveryError } from './types.js';
import { child, directory, hashFile } from './files.js';
import { readManifest } from './manifest.js';
const reserved = ['manifest.ndjson', 'archive-control.sqlite'];
/** Complete closed archive only; trailing/unlisted files, links and partial seals refuse. */
export async function verifyArchive(io: RecoveryIO, root: string, input: RecoveryLimits) {
  const bounds = limits(input); await directory(io, root);
  const manifest = await readManifest(io, join(root, 'manifest.ndjson'));
  checkBounds(manifest, bounds);
  if (manifest.entries.some(entry => reserved.includes(entry.path))) throw new RecoveryError('integrity');
  await verifyLayout(io, root, manifest.entries);
  const seal = inspectHistoricalRecovery(join(root, 'archive-control.sqlite'), manifest.header.backupId);
  if (seal.operationId !== manifest.header.backupId || seal.manifestDigest !== manifest.sha256 || seal.attestationDigest !== manifest.sha256) throw new RecoveryError('incomplete');
  for (const entry of manifest.entries) {
    if (entry.kind === 'directory') await directory(io, child(root, entry.path));
    else {
      const observed = await hashFile(io, child(root, entry.path), entry.bytes);
      if (observed.bytes !== entry.bytes || observed.sha256 !== entry.sha256) throw new RecoveryError('integrity');
    }
  }
  return manifest;
}
async function verifyLayout(io: RecoveryIO, root: string, entries: readonly RecoveryEntry[]): Promise<void> {
  const expected = new Map(entries.map(entry => [entry.path, entry.kind]));
  for (const name of reserved) expected.set(name, 'file');
  if (await knownTree(io, root, expected) !== expected.size) throw new RecoveryError('integrity');
}

function checkBounds(manifest: Awaited<ReturnType<typeof readManifest>>, bounds: RecoveryLimits): void {
  if (manifest.entries.length > bounds.maximumEntries || manifest.bytes + manifest.manifestBytes + 65536 > bounds.maximumBytes) throw new RecoveryError('limit');
}