import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ProvisionError } from '../types.js';
import { canonical } from '../src/capture.js';
import type { Operation } from './files.js';
import {
  checkOperation,
  copyFile,
  names,
  readPrivate,
  removeOwned,
  stat,
  syncDirectory,
  unsafe,
  upgradeNative,
  writePrivate,
} from './files.js';

export interface ManifestEntry {
  readonly path: string;
  readonly kind: 'directory' | 'file';
  readonly mode: number;
  readonly size: number;
  readonly sha256: string | null;
}
export interface BackupSeal {
  readonly manifestDigest: string;
  readonly entries: number;
  readonly bytes: number;
}
export interface BackupLimits {
  readonly maximumEntries: number;
  readonly maximumBytes: number;
}
export const defaultBackupLimits: BackupLimits = Object.freeze({
  maximumEntries: 100_000,
  maximumBytes: 64 * 1024 ** 3,
});
const MANIFEST_BYTES = 32 * 1024 * 1024;
interface Walk {
  readonly entries: ManifestEntry[];
  bytes: number;
  readonly limits: BackupLimits;
  readonly operation: Operation;
}
function charge(walk: Walk, entry: ManifestEntry): void {
  walk.entries.push(entry);
  walk.bytes += entry.size;
  if (walk.entries.length > walk.limits.maximumEntries || walk.bytes > walk.limits.maximumBytes)
    throw new ProvisionError('upgrade_blocked');
  checkOperation(walk.operation);
}
/** Mirrors one private tree: directories and regular single-link files only; modes preserved. */
async function copyTree(source: string, destination: string, prefix: string, walk: Walk): Promise<void> {
  const info = await stat(source);
  unsafe(info && info.isDirectory() && !info.isSymbolicLink());
  await upgradeNative.mkdir(destination, { mode: 0o700 });
  const mode = Number(info.mode & 0o777n);
  charge(walk, { path: prefix, kind: 'directory', mode, size: 0, sha256: null });
  for (const name of await names(source, walk.limits.maximumEntries)) {
    const from = join(source, name);
    const to = join(destination, name);
    const item = await stat(from);
    unsafe(item && !item.isSymbolicLink() && (item.isDirectory() || item.isFile()));
    if (item.isDirectory()) await copyTree(from, to, `${prefix}/${name}`, walk);
    else {
      const copied = await copyFile(from, to, walk.operation);
      const fileMode = Number(item.mode & 0o777n);
      await upgradeNative.chmod(to, fileMode);
      charge(walk, { path: `${prefix}/${name}`, kind: 'file', mode: fileMode, ...copied });
    }
  }
  await syncDirectory(destination);
  await upgradeNative.chmod(destination, mode);
}
export interface BackupInput {
  readonly root: string;
  /** Additional single files outside the root, such as the Compose bootstrap gate. */
  readonly extras: readonly { readonly name: string; readonly path: string }[];
  /** Operation-owned directory; `backup.partial` and `backup` below it are replaced. */
  readonly directory: string;
  readonly header: { readonly operationId: string; readonly installationId: string };
}
const sealDigest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Exact cold copy, sealed by the manifest digest; the caller records the seal durably. */
export async function takeBackup(input: BackupInput, limits: BackupLimits, operation: Operation): Promise<BackupSeal> {
  const partial = join(input.directory, 'backup.partial');
  const final = join(input.directory, 'backup');
  await removeOwned(partial);
  await removeOwned(final);
  await upgradeNative.mkdir(partial, { mode: 0o700 });
  const walk: Walk = { entries: [], bytes: 0, limits, operation };
  await copyTree(input.root, join(partial, 'data'), 'data', walk);
  if (input.extras.length) {
    await upgradeNative.mkdir(join(partial, 'extra'), { mode: 0o700 });
    charge(walk, { path: 'extra', kind: 'directory', mode: 0o700, size: 0, sha256: null });
    for (const extra of input.extras) {
      unsafe(/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(extra.name));
      const copied = await copyFile(extra.path, join(partial, 'extra', extra.name), operation);
      charge(walk, { path: `extra/${extra.name}`, kind: 'file', mode: 0o600, ...copied });
    }
    await syncDirectory(join(partial, 'extra'));
  }
  const manifest = { version: 1, ...input.header, createdAt: new Date().toISOString(), entries: walk.entries };
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > MANIFEST_BYTES) throw new ProvisionError('upgrade_blocked');
  await writePrivate(join(partial, 'manifest.json'), bytes);
  await upgradeNative.rename(partial, final);
  await syncDirectory(input.directory);
  return { manifestDigest: sealDigest(bytes), entries: walk.entries.length, bytes: walk.bytes };
}
export interface Manifest {
  readonly operationId: string;
  readonly installationId: string;
  readonly entries: readonly ManifestEntry[];
}
/** Reads the sealed manifest; a missing, partial or mismatched seal refuses. */
export async function readManifest(directory: string, seal: BackupSeal): Promise<Manifest> {
  const bytes = await readPrivate(join(directory, 'backup', 'manifest.json'), MANIFEST_BYTES);
  if (!bytes || sealDigest(bytes) !== seal.manifestDigest) throw new ProvisionError('recovery_required');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Manifest;
  if (!Array.isArray(value.entries) || value.entries.length !== seal.entries)
    throw new ProvisionError('recovery_required');
  return value;
}
/**
 * Copies the sealed `data` tree into a fresh operation-owned target and proves every
 * directory, mode, size and digest equals the manifest before the caller swaps it in.
 */
export async function restoreInto(
  directory: string,
  manifest: Manifest,
  target: string,
  operation: Operation,
): Promise<void> {
  await removeOwned(target);
  const walk: Walk = { entries: [], bytes: 0, limits: defaultBackupLimits, operation };
  await copyTree(join(directory, 'backup', 'data'), target, 'data', walk);
  const expected = manifest.entries.filter((entry) => entry.path === 'data' || entry.path.startsWith('data/'));
  if (canonicalEntries(walk.entries) !== canonicalEntries(expected)) {
    await removeOwned(target);
    throw new ProvisionError('recovery_required');
  }
}
const canonicalEntries = (entries: readonly ManifestEntry[]): string =>
  entries
    .map((entry) => canonical({ ...entry }))
    .sort()
    .join('\n');
