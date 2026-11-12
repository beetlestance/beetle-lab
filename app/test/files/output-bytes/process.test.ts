import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, deferred, finish, fixture, pending, record, populated, id } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture; const children = new Set<ChildProcess>();
async function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
}
afterEach(async () => { await Promise.all([...children].map(kill)); children.clear(); await files?.dispose(); });
function child(mode: 'contender' | 'cleanup' | 'cleanup-directory' | 'cleanup-removal' | 'cleanup-removal-directory', request?: object) {
  if (children.size >= 4) throw new Error('Synthetic process bound');
  const encoded = request ? JSON.stringify(request) : ''; if (encoded.length > 8192) throw new Error('Synthetic input bound');
  const child = fork(join(process.cwd(), 'app/test/files/output-bytes/process.child.ts'), [files.root, mode, encoded],
    { execArgv: ['--max-old-space-size=128', '--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child); const exit = once(child, 'exit');
  const ready = new Promise<unknown>((resolve, reject) => {
    let stderr = 0; const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic readiness timeout')); }, 5000);
    child.stderr?.on('data', (bytes: Buffer) => { stderr += bytes.length; if (stderr > 4096) { child.kill('SIGKILL'); reject(new Error('Synthetic stderr bound')); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic premature exit')); });
    child.once('message', (value: unknown) => { clearTimeout(timer); resolve(value); });
  });
  return { child, ready, exit };
}
it('retains the real namespace lock until a held original file close settles', async () => {
  let enabled = false; let held = false; const gate = deferred(); const entered = deferred();
  files = await fixture({ ...nativePort, close: async handle => {
    if (enabled && !held && !(await handle.stat()).isDirectory()) { held = true; entered.resolve(); await gate.promise; }
    await nativePort.close(handle);
  } });
  let value = record(); value = advance(value, await finish(files.store.prepare(value, context()))); enabled = true;
  const job = files.store.append({ record: value, offset: 0, bytes: Buffer.from('abc') }, context());
  const rejection = expect(job.result).rejects.toMatchObject({ code: 'cancelled' }); await entered.promise;
  const close = files.store.close(); expect(await pending(close)).toBe(true);
  try { const contender = child('contender'); expect(await contender.ready).toEqual({ kind: 'excluded' }); await contender.exit; }
  finally { gate.resolve(); await rejection; await job.settled; await close; }
  const contender = child('contender'); expect(await contender.ready).toEqual({ kind: 'acquired' }); await contender.exit;
});
it.each(['file', 'directory'] as const)('keeps a failed %s close job/token/namespace strongly owned until confirmed process death', async kind => {
  files = await fixture(); await files.store.close();
  const active = child(kind === 'file' ? 'cleanup' : 'cleanup-directory');
  expect(await active.ready).toEqual({ kind: 'cleanup', code: 'cleanup', closed: 'cleanup', admission: 'closed', closes: 1, pending: true, cached: true });
  const before = await lstat(files.path(record()), { bigint: true });
  const contender = child('contender'); expect(await contender.ready).toEqual({ kind: 'excluded' }); await contender.exit;
  await kill(active.child); expect(active.child.signalCode).toBe('SIGKILL');
  await files.reopen(); await finish(files.store.prepare(record(), context()));
  const after = await lstat(files.path(record()), { bigint: true }); expect(after.ino).toBe(before.ino);
});

it.each(['file', 'directory'] as const)('retains namespace and unsettled removal after unknown %s close until process death', async kind => {
  files = await fixture(); const value = await populated(files); const publishing = {...value, artifact: {...value.artifact, phase: 'publishing' as const}};
  const record = advance(publishing, await finish(files.store.publish(publishing, context())), 'published');
  const request = await finish(files.store.prepareRemoval({record, deletionId: id(40), deletionVersion: 1}, context())); await files.store.close();
  const active = child(kind === 'file' ? 'cleanup-removal' : 'cleanup-removal-directory', request);
  expect(await active.ready).toEqual({kind: 'cleanup', code: 'cleanup', closed: 'cleanup', admission: 'closed', closes: 1, pending: true, cached: true});
  await expect(lstat(files.path(record, true))).rejects.toMatchObject({code: 'ENOENT'});
  const contender = child('contender'); expect(await contender.ready).toEqual({kind: 'excluded'}); await contender.exit;
  await kill(active.child); expect(active.child.signalCode).toBe('SIGKILL');
  await files.reopen(); expect((await finish(files.store.remove(request, context()))).phase).toBe('absent');
});
