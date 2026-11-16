import { chmod, lstat, readdir, mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach } from 'vitest';
import header from '../../../contracts/fixtures/valid/recovery-header.json' with {type: 'json'};
import { captureRecoveryRecord } from '@beetle/contracts/recovery';
import { initializeHistoricalRecovery, openBackendRecovery } from '../../../app/src/bootstrap/recovery-control/index.js';
import { RecoveryIO } from '../src/io.js';
import { SnapshotTree } from '../src/tree.js';
import { writeManifest } from '../src/manifest.js';
const roots: string[] = [];
afterEach(async () => {for (const root of roots.splice(0)) await cleanup(root);});
function io() {return new RecoveryIO({signal: new AbortController().signal, deadline: performance.now() + 10000});}
export async function archiveFixture(overrides: Readonly<Record<string, string>> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-archive-'))); roots.push(root);
  const source = join(root, 'source'); const destination = join(root, 'archive');
  await mkdir(source, {mode: 0o700}); await mkdir(destination, {mode: 0o700});
  await writeFile(join(source, 'item'), new Uint8Array(131073).fill(13), {mode: 0o600});
  const owner = io(); const bounds = {maximumBytes: 8388608, maximumEntries: 100};
  const tree = new SnapshotTree(owner, destination, bounds);
  for (const path of Object.values(header.roles)) if (path) await tree.file(overrides[path] ?? join(source, 'item'), path, overrides[path] && path === header.roles.metadata ? 'metadata' : false);
  const snapshot = tree.snapshot(); const records = [captureRecoveryRecord(header), ...snapshot.entries,
    captureRecoveryRecord({kind: 'footer', files: snapshot.files, directories: snapshot.directories, bytes: snapshot.bytes})];
  const manifestPath = join(destination, 'manifest.ndjson');
  const result = await writeManifest(owner, manifestPath, records, 33554432); await owner.closeAll();
  const control = join(destination, 'archive-control.sqlite');
  initializeHistoricalRecovery({path: control, historyId: header.backupId, operationId: header.backupId, manifestDigest: result.sha256});
  const lease = openBackendRecovery(control, header.backupId); lease.completeHistorical(header.backupId, result.sha256, result.sha256); lease.close();
  return {root, source, destination, manifestPath, bounds, result};
}

async function cleanup(path: string): Promise<void> {
  if ((await lstat(path)).isDirectory()) {await chmod(path, 0o700); for (const name of await readdir(path)) await cleanup(join(path, name));}
  await rm(path, {recursive: true, force: true});
}
