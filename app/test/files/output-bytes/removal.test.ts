import type { OutputDeletionRequest } from '../../../src/ports/output-deletion.js';
import { afterEach, expect, it } from 'vitest';
import { link, lstat, mkdir, readFile, rename, symlink, writeFile, rm, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { OUTPUT_DELETION_BYTES } from '../../../src/ports/output-deletion.js';
import { encodeJson } from '@beetle/contracts';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, finish, fixture, id, populated } from './fixture.js';
import type { Fixture } from './fixture.js';
let files: Fixture; const plans = new Map<string, OutputDeletionRequest>();
afterEach(async () => {await files?.dispose(); plans.clear();});
async function published(bytes = Buffer.from('abc'), token = 7) {
  const value = await populated(files, bytes, token); const publishing = {...value, artifact: {...value.artifact, phase: 'publishing' as const}};
  const record = advance(publishing, await finish(files.store.publish(publishing, context())), 'published');
  plans.set(record.artifact.token, await finish(files.store.prepareRemoval({record, deletionId: id(40), deletionVersion: 1}, context())));
  return record;
}
function intent(record: Awaited<ReturnType<typeof published>>): OutputDeletionRequest {
  const plan = plans.get(record.artifact.token); if (!plan) throw new Error('Missing synthetic durable plan');
  return {...plan, record};
}
it('unlinks the exact published file, preserves directories and replays absence across reopen', async () => {
  files = await fixture(); const record = await published(); const request = intent(record);
  const result = await finish(files.store.remove(request, context())); expect(result).toEqual({...request, phase: 'absent'});
  expect(Buffer.byteLength(encodeJson(result, OUTPUT_DELETION_BYTES))).toBeLessThanOrEqual(OUTPUT_DELETION_BYTES);
  await expect(lstat(files.path(record, true))).rejects.toMatchObject({code: 'ENOENT'});
  expect((await lstat(dirname(files.path(record, true)))).isDirectory()).toBe(true);
  expect(await finish(files.store.remove(request, context()))).toEqual(result);
  await files.reopen(); expect(await finish(files.store.remove(request, context()))).toEqual(result);
});
it('recovers missing ancestors without creating directories and flushes nearest parents', async () => {
  let enabled = false; let syncs = 0;
  files = await fixture({...nativePort, sync: async handle => {if (enabled) syncs++; await nativePort.sync(handle);}});
  const record = await published(); await finish(files.store.remove(intent(record), context()));
  await rm(dirname(files.path(record, true)), {recursive: true}); await rm(dirname(files.path(record)), {recursive: true}); enabled = true;
  expect((await finish(files.store.remove(intent(record), context()))).phase).toBe('absent'); expect(syncs).toBe(2);
  await expect(lstat(dirname(files.path(record, true)))).rejects.toMatchObject({code: 'ENOENT'});
});
it.each(['identity', 'binding', 'bytes', 'ordinal', 'sha256'] as const)('preserves a present file for mismatched %s', async field => {
  files = await fixture(); const record = await published(); let changed = structuredClone(record);
  if (field === 'binding') changed = {...changed, binding: {...changed.binding, journalAuthority: id(99)}};
  else if (field === 'identity') changed = {...changed, artifact: {...changed.artifact, identity: '0'.repeat(64)}};
  else if (field === 'bytes') changed = {...changed, artifact: {...changed.artifact, bytes: 4, offset: 4}};
  else if (field === 'ordinal') changed = {...changed, artifact: {...changed.artifact, ordinal: 1}};
  else changed = {...changed, artifact: {...changed.artifact, sha256: '0'.repeat(64)}};
  await expect(finish(files.store.prepareRemoval({record: changed, deletionId: id(40), deletionVersion: 1}, context()))).rejects.toMatchObject({code: 'integrity'});
  await expect(finish(files.store.remove(intent(changed), context()))).rejects.toMatchObject({code: 'integrity'});
  expect(await readFile(files.path(record, true), 'utf8')).toBe('abc');
});
it.each(['replacement', 'extra_link', 'symlink', 'staging', 'changed_bytes'] as const)('preserves unexpected %s instead of deleting it', async kind => {
  files = await fixture(); const record = await published(); const path = files.path(record, true); const other = path + '-preserve';
  if (kind === 'replacement') {await rename(path, other); await writeFile(path, 'abc', {mode: 0o600});}
  if (kind === 'changed_bytes') await writeFile(path, 'xyz');
  if (kind === 'extra_link') await link(path, other);
  if (kind === 'symlink') {await rename(path, other); await symlink(other, path);}
  if (kind === 'staging') {await mkdir(dirname(files.path(record)), {recursive: true, mode: 0o700}); await writeFile(files.path(record), 'stage', {mode: 0o600});}
  await expect(finish(files.store.remove(intent(record), context()))).rejects.toMatchObject({code: 'integrity'});
  expect(await readFile(path, 'utf8')).toBe(kind === 'changed_bytes' ? 'xyz' : 'abc');
  if (kind === 'staging') expect(await readFile(files.path(record), 'utf8')).toBe('stage');
});
it('reports unlink acknowledgement loss or failed parent sync without inventing absence', async () => {
  files = await fixture(); const record = await published(); let enabled = true;
  await files.reopen({...nativePort, unlink: async path => {await nativePort.unlink(path); if (enabled) throw new Error('Synthetic lost unlink acknowledgement');}});
  await expect(finish(files.store.remove(intent(record), context()))).rejects.toMatchObject({code: 'io'}); enabled = false;
  await files.reopen({...nativePort, sync: async () => {throw new Error('Synthetic failed flush');}});
  await expect(finish(files.store.remove(intent(record), context()))).rejects.toMatchObject({code: 'io'});
  await files.reopen(); expect((await finish(files.store.remove(intent(record), context()))).phase).toBe('absent');
});
it('refuses malformed/proxy/getter intent snapshots before native effects', async () => {
  let effects = 0; let enabled = false;
  files = await fixture({...nativePort, lstat: async (...args) => {if (enabled) effects++; return nativePort.lstat(...args);}});
  const record = await published(); enabled = true; let getterCalls = 0;
  const getter = Object.defineProperty({...intent(record)}, 'deletionId', {enumerable: true, get() {getterCalls++; return id(40);}});
  const invalid = [new Proxy(intent(record), {ownKeys() {getterCalls++; return [];}}), getter, {...intent(record), unknown: true},
    {...intent(record), deletionVersion: 0}, {...intent(record), deletionVersion: Number.MAX_SAFE_INTEGER + 1},
    {...intent(record), deletionId: 'bad'}, {...intent(record), record: {...record, artifact: {...record.artifact, writer: id(8)}}}];
  for (const value of invalid) await expect(finish(files.store.remove(value, context()))).rejects.toMatchObject({code: 'invalid_input'});
  expect(effects).toBe(0); expect(getterCalls).toBe(0);
});
it('refuses absence from a wrong namespace while the original file remains owned elsewhere', async () => {
  files = await fixture(); const original = files; const record = await published(); const request = intent(record); await original.store.close();
  const other = await fixture();
  try {await expect(finish(other.store.remove(request, context()))).rejects.toMatchObject({code: 'integrity'});}
  finally {await other.dispose(); await original.reopen();}
  expect(await readFile(original.path(record, true), 'utf8')).toBe('abc');
});

it('refuses fresh preparation for missing custody and alteration of an existing prepared intent', async () => {
  files = await fixture(); const record = await published(); const plan = intent(record);
  for (const changed of [{...plan, deletionId: id(41)}, {...plan, deletionVersion: 2}, {...plan, namespaceIdentity: '0'.repeat(64)}, {...plan, preparationIdentity: '0'.repeat(64)}]) {
    await expect(finish(files.store.remove(changed, context()))).rejects.toMatchObject({code: 'integrity'});
  }
  expect(await readFile(files.path(record, true), 'utf8')).toBe('abc'); await unlink(files.path(record, true));
  await expect(finish(files.store.prepareRemoval({record, deletionId: id(40), deletionVersion: 1}, context()))).rejects.toMatchObject({code: 'custody_missing'});
  expect((await finish(files.store.remove(plan, context()))).phase).toBe('absent');
});
