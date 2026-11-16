import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runtimeName } from '../../src/runtime-identity.js';
import { cleanupControl } from '../../src/cleanup-control/index.js';
import { admissionFixture, scope, reserved } from '../admission/fixtures.js';
import { rootFacts, syntheticMarker, bindSyntheticNamespace, directories } from './model-fixtures.js';
const f = admissionFixture();
it('commits one immutable root/marker binding and replays it exactly across reopen without changing original history', async () => {
  const path = f.path(); let journal = await f.open(path);
  const input = { ...rootFacts, native: { ...rootFacts.native } }; const pending = journal.stagingNamespace.begin(input); input.native = { ...input.native, ino: '99' };
  const intent = await pending;
  expect(intent.root).toEqual(rootFacts); expect(await journal.stagingNamespace.begin(rootFacts)).toEqual(intent);
  expect(await journal.stagingNamespace.read()).toEqual({ state: 'preparing', intent });
  await expect(journal.stagingNamespace.commit({ intent: { ...intent, nonce: 'f'.repeat(64) }, marker: syntheticMarker(intent) })).rejects.toMatchObject({ code: 'invalid_input' });
  const marker = syntheticMarker(intent); const anchor = await journal.stagingNamespace.commit({ intent, marker });
  expect(await journal.stagingNamespace.commit({ intent, marker })).toEqual(anchor);
  await expect(journal.stagingNamespace.commit({ intent, marker: syntheticMarker(intent, '9007199254740998') })).rejects.toMatchObject({ code: 'conflict' });
  await expect(journal.stagingNamespace.begin({ ...rootFacts, native: { ...rootFacts.native, ino: '99' } })).rejects.toMatchObject({ code: 'recovery_required' });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.stagingNamespace.read()).toEqual({ state: 'bound', intent, anchor });
  expect(await journal.stagingNamespace.begin(rootFacts)).toEqual(intent);
});
it('refuses new anchor adoption after retained history, preserving event-only quota and data', async () => {
  const path = f.path(); const journal = await f.open(path, 1024); const original = f.offer();
  await journal.immutableOffer(original); await journal.appendWrapper(f.wrapper());
  const before = await journal.get(f.key());
  await expect(journal.stagingNamespace.begin(rootFacts)).rejects.toMatchObject({ code: 'recovery_required' });
  expect(await journal.get(f.key())).toEqual(before);
  expect(await journal.readOffer(f.key())).toEqual(original);
  await f.close(journal); const db = new DatabaseSync(path);
  expect(db.prepare('SELECT cleanup_control_bytes,staging_namespace_identity,quota_bytes FROM accepted_attempts').get())
    .toEqual({ cleanup_control_bytes: 0, staging_namespace_identity: null, quota_bytes: 1024 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM installed_staging_namespace').get()?.n).toBe(0); db.close();
});
it('records exact four-role task facts with purpose/original/namespace binding and refuses later replacements', async () => {
  const path = f.path(); const journal = await f.configured(path); const job = f.job();
  await f.enqueue(journal, job); reserved(await f.admit(journal, job));
  const installed = await journal.stagingNamespace.read(); if (installed?.state !== 'bound') throw new Error('Missing synthetic binding');
  const intent = { protocolVersion: 1 as const, original: { ...scope(job), generation: 1 as const, intentDigest: job.intentDigest },
    purpose: 'performance' as const, namespaceIdentity: installed.anchor.namespaceIdentity, specDigest: 'e'.repeat(64),
    runtimeName: runtimeName({ ...scope(job), installationId: rootFacts.installationId }) };
  expect(await journal.stagingNamespace.beginTask(intent)).toEqual({ state: 'preparing', intent });
  await expect(journal.stagingNamespace.beginTask({ ...intent, runtimeName: 'wrong' })).rejects.toMatchObject({ code: 'conflict' });
  const facts = directories(); const anchor = await journal.stagingNamespace.commitTask({ intent, directories: facts });
  expect(await journal.stagingNamespace.commitTask({ intent, directories: facts })).toEqual(anchor);
  await expect(journal.stagingNamespace.commitTask({ intent, directories: { ...facts, input: { ...facts.input, ino: '9000' } } })).rejects.toMatchObject({ code: 'conflict' });
  expect(await journal.stagingNamespace.readTask({ ...scope(job), generation: 1 })).toEqual({ state: 'prepared', intent, anchor });
  await expect(journal.stagingNamespace.readTask({ ...scope(job), generation: 1, workspaceId: f.job(2).organizationId })).rejects.toMatchObject({ code: 'not_found' });
  await f.close(journal); const db = new DatabaseSync(path);
  expect(db.prepare('SELECT cleanup_control_bytes FROM accepted_attempts').get()?.cleanup_control_bytes).toBe(cleanupControl.reservedBytes);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
});
it('replays a pending fresh intent after reopen', async () => {
  const path = f.path(); let journal = await f.open(path); const intent = await journal.stagingNamespace.begin(rootFacts);
  await f.close(journal); journal = await f.open(path);
  expect(await journal.stagingNamespace.begin(rootFacts)).toEqual(intent);
  await bindSyntheticNamespace(journal);
  expect((await journal.stagingNamespace.read())?.state).toBe('bound');
});
