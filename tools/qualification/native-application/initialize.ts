import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAgentConfiguration, installationStatePath } from '../../../agent/src/bootstrap/index.js';
import { initializeInstallationState } from '../../../agent/src/installation-state/index.js';
import type { InitializingState } from '../../../agent/src/installation-state/index.js';
import { openJournal } from '../../../agent/src/journal/index.js';
import type { Journal } from '../../../agent/src/journal/index.js';

interface InitializationOptions {
  readonly configPath: string;
  readonly uid: number;
  readonly gid: number;
}
export function initializationWorkerUrl(): URL {
  return pathToFileURL(resolve(process.env.BEETLE_AGENT_WORKER_FILE ?? 'agent/dist/worker.js'));
}
async function privateFiles(journalPath: string, owner: InitializationOptions): Promise<void> {
  const gatePath = installationStatePath(journalPath);
  const required = new Set([basename(journalPath), basename(gatePath)]);
  const allowed = new Set([...required, `${basename(journalPath)}-wal`, `${basename(journalPath)}-shm`, `${basename(gatePath)}-journal`]);
  const directory = await opendir(dirname(journalPath)); let count = 0;
  for await (const entry of directory) {
    assert(++count <= 5 && allowed.has(entry.name), 'Unexpected fresh installation files');
    const file = await open(join(dirname(journalPath), entry.name), constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const original = await file.stat();
      assert(original.isFile() && original.nlink === 1 && original.uid === process.getuid?.() && original.size <= 16_777_216);
      await file.chmod(0o600);
      if (original.uid !== owner.uid || original.gid !== owner.gid) await file.chown(owner.uid, owner.gid);
      const actual = await file.stat();
      assert.equal(actual.uid, owner.uid); assert.equal(actual.gid, owner.gid); assert.equal(actual.mode & 0o777, 0o600);
      required.delete(entry.name);
    } finally { await file.close(); }
  }
  assert.equal(required.size, 0, 'Fresh journal and ready gate must both exist');
}
/** Explicit new synthetic installation operation. Never serving-startup fallback.
 * Loader supplies the journal path; real Journal supplies its durable authority.
 * All providers/SQLite handles close before files are secured and Docker may start.
 */
export async function initializeFreshInstallation(options: InitializationOptions) {
  const loaded = await loadAgentConfiguration({ BEETLE_AGENT_CONFIG_FILE: options.configPath }, initializationWorkerUrl());
  let journal: Journal | undefined; let initializer: InitializingState | undefined;
  let journalAuthority: string | undefined;
  const failures: unknown[] = [];
  const journalPath = loaded.runtime.journal.path;
  try {
    assert.equal(loaded.runtime.installation.user, `${options.uid}:${options.gid}`);
    const parent = await lstat(dirname(journalPath));
    assert(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o777) === 0o700);
    assert.equal(parent.uid, options.uid); assert.equal(parent.gid, options.gid);
    journal = await openJournal(loaded.runtime.journal);
    journalAuthority = await journal.journalAuthority();
    initializer = initializeInstallationState(installationStatePath(journalPath));
    initializer.complete(journalAuthority);
  } catch (error) { failures.push(error); }
  const closed = await Promise.allSettled([Promise.resolve().then(() => initializer?.close()),
    Promise.resolve().then(() => journal?.close()), Promise.resolve().then(() => loaded.close())]);
  for (const result of closed) if (result.status === 'rejected') failures.push(result.reason);
  if (failures.length) throw new AggregateError(failures, 'Fresh qualification installation initialization failed');
  assert(journalAuthority); await privateFiles(journalPath, options);
  return { journalPath, journalAuthority, gatePath: installationStatePath(journalPath) };
}
