import * as fsSync from 'node:fs';
import { constants } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { RecoveryIO } from '../src/io.js';
import { copyFile } from '../src/files.js';
import { copyDatabase } from '../src/database.js';
const roots: string[] = [];
afterEach(async () => {vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, {recursive: true, force: true})));});
async function root() {const value = await realpath(await mkdtemp(join(tmpdir(), 'beetle-recovery-io-'))); roots.push(value); return value;}
function io() {return new RecoveryIO({signal: new AbortController().signal, deadline: performance.now() + 10000});}
it('copies and independently hashes bounded files without overwriting an existing destination', async () => {
  const path = await root(); const owner = io(); const bytes = new Uint8Array(200000).fill(41);
  await writeFile(join(path, 'source'), bytes, {mode: 0o600});
  try {
    const receipt = await copyFile(owner, join(path, 'source'), join(path, 'copied'), bytes.length);
    expect(receipt.bytes).toBe(bytes.length); expect(await readFile(join(path, 'copied'))).toEqual(Buffer.from(bytes));
    await expect(copyFile(owner, join(path, 'source'), join(path, 'copied'), bytes.length)).rejects.toThrow();
  } finally {await owner.closeAll();}
});
it('keeps close originals held after cancellation and never releases on the abort hint', async () => {
  const path = await root(); const controller = new AbortController(); const owner = new RecoveryIO({signal: controller.signal, deadline: performance.now() + 10000});
  const file = await owner.acquireFile(join(path, 'owned'), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL);
  let resolve!: () => void; const held = new Promise<void>(done => {resolve = done;}); const original = file.value.close.bind(file.value);
  vi.spyOn(file.value, 'close').mockImplementation(async () => {await held; await original();});
  controller.abort(); const closing = owner.closeAll(); let closed = false; void closing.then(() => {closed = true;});
  await Promise.resolve(); expect(closed).toBe(false); expect(owner.closeAll()).toBe(closing);
  resolve(); await closing; expect(closed).toBe(true);
});
it('takes a consistent SQLite backup and removes active browser credentials only in the copy', async () => {
  const path = await root(); const source = join(path, 'source.sqlite'); const destination = join(path, 'copied.sqlite');
  const db = new DatabaseSync(source); db.exec('CREATE TABLE local_browser_session(id,session_json); CREATE TABLE retained(id); INSERT INTO retained VALUES(7); PRAGMA user_version=27;');
  db.prepare('INSERT INTO local_browser_session VALUES(1,?)').run('PRIVATE_COOKIE_CANARY'); db.close();
  const owner = io();
  try {
    const receipt = await copyDatabase(owner, source, destination, 1048576, 'metadata'); expect(receipt.bytes).toBeGreaterThan(0);
    const copied = new DatabaseSync(destination, {readOnly: true});
    try {expect(copied.prepare('SELECT id FROM retained').get()?.id).toBe(7); expect(copied.prepare('SELECT * FROM local_browser_session').all()).toEqual([]);}
    finally {copied.close();}
    const original = new DatabaseSync(source, {readOnly: true});
    try {expect(original.prepare('SELECT session_json FROM local_browser_session').get()?.session_json).toBe('PRIVATE_COOKIE_CANARY');}
    finally {original.close();}
  } finally {await owner.closeAll();}
});
it.each(['backup','open'] as const)('refuses destination replacement before native SQLite %s without writing the external victim', async method => {
  const path = await root(); const source = join(path, 'original.sqlite'); const destination = join(path, 'copy.sqlite'); const victim = join(path, 'victim.sqlite');
  const db = new DatabaseSync(source); db.exec('CREATE TABLE retained(id); INSERT INTO retained VALUES(7);'); db.close();
  const target = new DatabaseSync(victim); target.exec('CREATE TABLE canary(value); INSERT INTO canary VALUES(42);'); target.close();
  const {chmod, rename, symlink} = await import('node:fs/promises'); await chmod(victim, 0o600);
  const before = await readFile(victim); const {nativeDatabase} = await import('../src/database-custody.js');
  const original = nativeDatabase[method]; let calls = 0;
  if (method === 'backup') vi.spyOn(nativeDatabase, 'backup').mockImplementationOnce(async (...args) => {
    calls++; await rename(destination, destination + '.old'); await symlink(victim, destination);
    return (original as typeof nativeDatabase.backup)(...args);
  });
  else vi.spyOn(nativeDatabase, 'open').mockImplementationOnce(destination => {
    // Native-open boundary is synchronous; use native synchronous fixture mutation.
    const fs = fsSync; calls++; fs.renameSync(destination.path, destination.path + '.old'); fs.symlinkSync(victim, destination.path);
    return (original as typeof nativeDatabase.open)(destination);
  });
  const owner = io();
  try {await expect(copyDatabase(owner, source, destination, 1048576)).rejects.toThrow('integrity');}
  finally {await owner.closeAll();}
  expect(calls).toBe(1); expect(await readFile(victim)).toEqual(before);
});
it('charges deep-and-wide pending siblings before following the next deep directory', async () => {
  const path = await root(); const {mkdir, symlink} = await import('node:fs/promises');
  const source = join(path, 'published'); const target = join(path, 'archive');
  await mkdir(source, {mode: 0o700}); await mkdir(target, {mode: 0o700});
  await mkdir(join(source, 'a'), {mode: 0o700}); await mkdir(join(source, 'a/a'), {mode: 0o700});
  for (const directory of [source, join(source, 'a')]) for (let n = 0; n < 120; n++) await writeFile(join(directory, 's' + n), '', {mode: 0o600});
  await symlink('/unreachable', join(source, 'a/a/unsafe'));
  const {SnapshotTree} = await import('../src/tree.js'); const owner = io();
  try {await expect(new SnapshotTree(owner, target, {maximumBytes: 1048576, maximumEntries: 200}).published(source, 'published')).rejects.toThrow('limit');}
  finally {await owner.closeAll();}
});
