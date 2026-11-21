import type { OutputBinding } from '../../../../domain/output-owner/index.js';
import type { OutputFileRecord } from '../../../../ports/output-bytes.js';
import type { PhysicalFile, Roots } from '../custody/index.js';
import { identity } from './identity.js';
import { fail } from './errors.js';

/**
 * Published reads after the device or inode numbers moved (decision 029): Docker Desktop's
 * VirtioFS renumbers inodes across VM restarts, and an upgrade rollback restores copies.
 * The recorded identity binds the original inode, so it can no longer match. A read then
 * proves the durable facts instead (size, owner, mode, single link and the sealed SHA-256)
 * and pins the live physical identity for the rest of this start. Within one start the
 * physical check stays exact; the recorded identity is never rewritten.
 */
const PINS_PER_START = 4096;
const pins = new WeakMap<Roots, Map<string, string>>();

export async function matchPublishedRead(
  file: PhysicalFile,
  roots: Roots,
  record: OutputFileRecord<OutputBinding>,
): Promise<void> {
  await file.verify();
  const live = identity(record, roots, await file.handle.stat({ bigint: true }), true);
  const pinned = pins.get(roots)?.get(record.artifact.token);
  if (live !== record.artifact.identity && live !== pinned) {
    await proveDurable(file, roots, record);
    if (identity(record, roots, await file.handle.stat({ bigint: true }), true) !== live) fail('integrity');
    pin(roots, record.artifact.token, live);
  }
  await file.verify();
}

async function proveDurable(file: PhysicalFile, roots: Roots, record: OutputFileRecord<OutputBinding>): Promise<void> {
  const stat = await file.handle.stat({ bigint: true });
  const root = roots.published.stat;
  if (
    !stat.isFile() ||
    stat.nlink !== 1n ||
    stat.uid !== root.uid ||
    stat.gid !== root.gid ||
    (stat.mode & 0o7777n) !== 0o600n ||
    stat.dev !== root.dev
  )
    fail('integrity');
  await file.verifyContent({ bytes: record.artifact.bytes, sha256: record.artifact.sha256 });
}

function pin(roots: Roots, token: string, live: string): void {
  let map = pins.get(roots);
  if (!map) pins.set(roots, (map = new Map()));
  if (!map.has(token) && map.size >= PINS_PER_START) map.delete(map.keys().next().value as string);
  map.set(token, live);
}
