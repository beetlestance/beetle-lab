import type { OutputDeletionRequest } from '../../../src/ports/output-deletion.js';
import { afterEach, expect, it } from 'vitest';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, deferred, finish, fixture, id, pending, populated } from './fixture.js';
import type { Fixture } from './fixture.js';
let files: Fixture; const plans = new Map<string, OutputDeletionRequest>();
afterEach(async () => {await files?.dispose(); plans.clear();});
async function published(token = 7) {
  const value = await populated(files, Buffer.from('abc'), token); const next = {...value, artifact: {...value.artifact, phase: 'publishing' as const}};
  const record = advance(next, await finish(files.store.publish(next, context())), 'published');
  plans.set(record.artifact.token, await finish(files.store.prepareRemoval({record, deletionId: id(40), deletionVersion: 1}, context())));
  return record;
}
function intent(record: Awaited<ReturnType<typeof published>>): OutputDeletionRequest {
  const plan = plans.get(record.artifact.token); if (!plan) throw new Error('Missing synthetic durable plan');
  return {...plan, record};
}
it.each(['unlink', 'close'] as const)('retains cancelled %s originals, the shared token and shutdown ownership', async phase => {
  let enabled = false; let held = false; const gate = deferred(); const entered = deferred(); const controller = new AbortController();
  const hold = async () => {if (enabled && !held) {held = true; entered.resolve(); await gate.promise;}};
  files = await fixture({...nativePort,
    unlink: async path => {if (phase === 'unlink') await hold(); await nativePort.unlink(path);},
    close: async handle => {if (phase === 'close') await hold(); await nativePort.close(handle);},
  });
  const record = await published(); enabled = true;
  const job = files.store.remove(intent(record), {...context(), signal: controller.signal});
  const rejected = expect(job.result).rejects.toMatchObject({code: 'cancelled'}); await entered.promise; controller.abort();
  expect(await pending(job.result)).toBe(true); expect(await pending(job.settled)).toBe(true);
  await expect(finish(files.store.remove(intent(record), context()))).rejects.toMatchObject({code: 'busy'});
  const closing = files.store.close(); expect(await pending(closing)).toBe(true);
  gate.resolve(); await rejected; await job.settled; await closing;
  await files.reopen(); expect((await finish(files.store.remove(intent(record), context()))).phase).toBe('absent');
});
it('shares both physical credits with readers and never deletes under a held sink', async () => {
  files = await fixture(); const one = await published(); const two = await published(9); const gate = deferred(); const entered = deferred(); let calls = 0;
  const sink = {write: async () => {if (++calls === 2) entered.resolve(); await gate.promise;}};
  const a = files.store.read({record: one, start: 0, endExclusive: 3, sink}, context());
  const b = files.store.read({record: two, start: 0, endExclusive: 3, sink}, context()); await entered.promise;
  let captures = 0; const hostile = new Proxy(intent(one), {ownKeys() {captures++; return [];}});
  await expect(finish(files.store.remove(hostile, context()))).rejects.toMatchObject({code: 'busy'});
  await expect(finish(files.store.prepareRemoval({record: one, deletionId: id(40), deletionVersion: 1}, context()))).rejects.toMatchObject({code: 'busy'}); expect(captures).toBe(0);
  expect(await readFile(files.path(one, true), 'utf8')).toBe('abc'); gate.resolve(); await Promise.all([finish(a), finish(b)]);
  expect((await finish(files.store.remove(intent(one), context()))).phase).toBe('absent');
});
it('fences a deadline after native unlink without releasing proof before the original settles', async () => {
  let now = 100; let enabled = false; const entered = deferred(); const gate = deferred();
  files = await fixture({...nativePort, unlink: async path => {await nativePort.unlink(path); if (enabled) {entered.resolve(); await gate.promise;}}}, () => now);
  const record = await published(); enabled = true;
  const job = files.store.remove(intent(record), {deadline: 200, freeSpaceReserveBytes: 0});
  const rejected = expect(job.result).rejects.toMatchObject({code: 'deadline'}); await entered.promise; now = 201;
  expect(await pending(job.settled)).toBe(true); gate.resolve(); await rejected; await job.settled;
  enabled = false; expect((await finish(files.store.remove(intent(record), {deadline: 300, freeSpaceReserveBytes: 0}))).phase).toBe('absent');
});
it('rejects a new name introduced after the final original file closes', async () => {
  let enabled = false; let inserted = false; let path = '';
  files = await fixture({...nativePort, close: async handle => {
    const regular = (await handle.stat()).isFile(); await nativePort.close(handle);
    if (enabled && regular && !inserted) {inserted = true; await writeFile(path, 'replacement', {mode: 0o600});}
  }});
  const record = await published(); path = files.path(record, true); enabled = true;
  await expect(finish(files.store.remove(intent(record), context()))).rejects.toMatchObject({code: 'integrity'});
  expect(inserted).toBe(true); expect(await readFile(path, 'utf8')).toBe('replacement');
});
it('rechecks named ancestors after the post-close absence observation', async () => {
  let enabled = false; let closedFile = false; let replaced = false; let path = '';
  files = await fixture({...nativePort,
    close: async handle => {const regular = (await handle.stat()).isFile(); await nativePort.close(handle); if (enabled && regular) closedFile = true;},
    lstat: async (...args) => {
      try {return await nativePort.lstat(...args);} catch (cause) {
        if (enabled && closedFile && !replaced && args[0] === path) {
          replaced = true; const parent = dirname(path); await rename(parent, parent + '-retired'); await mkdir(parent, {mode: 0o700});
        }
        throw cause;
      }
    },
  });
  const record = await published(); path = files.path(record, true); enabled = true;
  await expect(finish(files.store.remove(intent(record), context()))).rejects.toMatchObject({code: 'integrity'});
  expect(replaced).toBe(true); expect((await lstat(dirname(path) + '-retired')).isDirectory()).toBe(true);
});
