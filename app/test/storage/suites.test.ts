import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { migration001 } from '../../src/adapters/outbound/sqlite/schema.js';
import { command, createFolder, requestId, scope, seed, storageFixture, uuid, settingsFixture, observation } from './fixture.js';
import { append, createSuite, largeConfig, request, suiteCommand } from './suites-fixture.js';

const fixture = storageFixture();
it('persists immutable history, global receipts, optimistic edits and original full revision replay', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata);
  const suite = await createSuite(metadata);
  expect(suite).toMatchObject({ version: 1, folderId: uuid(3), currentRevisionId: null });
  const body = request(); body.config.secrets = [{ name: 'token', provider: 'opaque', locator: 'unresolved-alias', version: 'v2' }];
  const first = await append(metadata, suite, 60, body);
  expect(first.config.secrets).toEqual(body.config.secrets);
  const current = await metadata.suites.getSuite({ scope, id: suite.id });
  expect(current).toMatchObject({ version: 2, currentRevisionId: first.id });
  const second = await append(metadata, current, 61, request(2));
  expect(second.ordinal).toBe(2);
  expect(await append(metadata, suite, 62, body)).toEqual(first);
  await expect(append(metadata, suite, 63)).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.namespaces.execute(command({ kind: 'createFolder', id: uuid(80), request: {
    scope, requestId: body.requestId, parentFolderId: uuid(3), name: 'Collision' } }))).rejects.toMatchObject({ code: 'conflict' });
  const page = await metadata.suites.listRevisions({ scope, suiteId: suite.id, limit: 1 });
  expect(page.items).toHaveLength(1); expect(page.items[0]).not.toHaveProperty('config');
  expect(page.items[0]).not.toHaveProperty('inputManifest');
  await expect(metadata.suites.listRevisions({ scope, suiteId: suite.id, limit: 2, cursor: page.nextCursor! }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  await fixture.close(metadata);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  expect(() => db.prepare('UPDATE suite_revisions SET digest=? WHERE id=?').run('b'.repeat(64), first.id)).toThrow();
  expect(() => db.prepare('DELETE FROM suite_revisions WHERE id=?').run(first.id)).toThrow(); db.close();
  metadata = await fixture.open(path); expect(await metadata.suites.getRevision({ scope, id: first.id })).toEqual(first);
  expect(await append(metadata, suite, 64, body)).toEqual(first);
});
it('isolates organizations, folders, names, races and failed receipts atomically', async () => {
  const metadata = await fixture.open(); await seed(metadata); await seed(metadata, 11, 12, 13);
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  const suite = await createSuite(metadata); await createSuite(metadata, 51, foreign, suite.name);
  await expect(metadata.suites.getSuite({ scope: foreign, id: suite.id })).rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.suites.execute(suiteCommand({ kind: 'createSuite', id: uuid(52), request: {
    scope, requestId: requestId(), name: 'Foreign', folderId: uuid(13) } }))).rejects.toMatchObject({ code: 'not_found' });
  await expect(createSuite(metadata, 53, scope, '  SUITE 50  ')).rejects.toMatchObject({ code: 'conflict' });
  const folder = await createFolder(metadata, 90); const body = { scope, requestId: requestId(), expectedVersion: 1, folderId: folder.id };
  const race = await Promise.allSettled([metadata.suites.execute(suiteCommand({ kind: 'patchSuite', id: suite.id, request: body })),
    metadata.suites.execute(suiteCommand({ kind: 'patchSuite', id: suite.id, request: { ...body, requestId: requestId(), name: 'Concurrent' } }))]);
  expect(race.map(value => value.status).sort()).toEqual(['fulfilled', 'rejected']);
  const invalid = request(2); invalid.config = { unsupported: true };
  await expect(append(metadata, { ...suite, version: 2 }, 62, invalid)).rejects.toMatchObject({ code: 'invalid_value' });
  invalid.config = request().config;
  expect((await append(metadata, { ...suite, version: 2 }, 62, invalid)).ordinal).toBe(1);
});
it('requires exact published input pins in the same workspace and deduplicates references', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path); await seed(metadata); await seed(metadata, 11, 12, 13);
  const suite = await createSuite(metadata); const body = request(); const pin = { id: uuid(90), sha256: 'a'.repeat(64), bytes: 12 };
  body.config.datasets = [{ id: 'a', kind: 'json', selection: 'byVu', input: pin },
    { id: 'b', kind: 'json', selection: 'byVu', input: { ...pin, id: pin.id.toUpperCase() } }];
  await expect(append(metadata, suite, 60, body)).rejects.toMatchObject({ code: 'not_found' });
  await fixture.close(metadata);
  // Trusted upstream metadata fixture only; this is not actual input byte publication.
  const db = new DatabaseSync(path); db.prepare('INSERT INTO input_blobs VALUES (?,?,?,?,?,?)')
    .run(pin.id, uuid(11), uuid(12), pin.sha256, pin.bytes, 'published');
  db.prepare('INSERT INTO input_blobs VALUES (?,?,?,?,?,?)').run(pin.id, scope.organizationId, scope.workspaceId, pin.sha256, pin.bytes, 'staging'); db.close();
  metadata = await fixture.open(path);
  await expect(append(metadata, suite, 60, body)).rejects.toMatchObject({ code: 'not_found' });
  await fixture.close(metadata); const publish = new DatabaseSync(path);
  publish.prepare("UPDATE input_blobs SET state='published' WHERE organization_id=?").run(scope.organizationId); publish.close();
  metadata = await fixture.open(path);
  const mismatch = structuredClone(body); (mismatch.config.datasets as { input: { bytes: number } }[])[0]!.input.bytes++;
  await expect(append(metadata, suite, 60, mismatch)).rejects.toMatchObject({ code: 'invalid_value' });
  const wrong = structuredClone(body); (wrong.config.datasets as { input: { bytes: number } }[]).forEach(value => value.input.bytes++);
  await expect(append(metadata, suite, 60, wrong)).rejects.toMatchObject({ code: 'not_found' });
  expect((await append(metadata, suite, 60, body)).inputManifest).toEqual([pin]);
});
it('accepts full one MiB UTF8 configuration and rejects oversized, unsafe and deep JSON', async () => {
  const metadata = await fixture.open(); await seed(metadata); const suite = await createSuite(metadata);
  const body = request(); body.config = largeConfig();
  expect(Buffer.byteLength(encodeJson(body.config, 1048576))).toBe(1048576);
  const revision = await append(metadata, suite, 60, body);
  expect(await metadata.suites.getRevision({ scope, id: revision.id })).toEqual(revision);
  const oversized = request(2); oversized.config = largeConfig(1048577);
  await expect(append(metadata, { ...suite, version: 2 }, 61, oversized)).rejects.toMatchObject({ code: 'invalid_value' });
  let invoked = false; const operation = suiteCommand({ kind: 'createSuite', id: uuid(70), request: { scope, requestId: requestId(), name: 'Safe' } });
  const accessor = Object.defineProperty({ ...operation }, 'request', { enumerable: true, get() { invoked = true; throw new Error('private'); } });
  await expect(metadata.suites.execute(accessor)).rejects.toMatchObject({ code: 'invalid_input' }); expect(invoked).toBe(false);
  const deep: Record<string, unknown> = {}; let node = deep; for (let i = 0; i < 70; i++) { node.child = {}; node = node.child as Record<string, unknown>; }
  expect(() => suiteCommand({ kind: 'createSuiteRevision', id: uuid(71), suiteId: suite.id, request: { ...request(2), config: deep } })).toThrow();
});
it('migrates v1 preserving settings, namespace rows and receipt replay', async () => {
  const path = fixture.path(); const db = new DatabaseSync(path, { enableForeignKeyConstraints: true }); db.exec(migration001);
  const store = new Store(db, { installation: settingsFixture().chain.installation, runtime: observation() });
  const original = command({ kind: 'createOrganization', id: uuid(1), request: {
    scope: { kind: 'installation' }, requestId: requestId(), name: 'Team', slug: 'team' } });
  const organization = store.execute({ kind: 'namespace', command: original });
  const settings = store.execute({ kind: 'getSettings', scope: { kind: 'installation' } });
  store.execute({ kind: 'namespace', command: command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3),
    request: { scope: { kind: 'organization', organizationId: uuid(1) }, requestId: requestId(), name: 'Project' } }) });
  db.close();
  const metadata = await fixture.open(path);
  expect(await metadata.getSettings({ kind: 'installation' })).toEqual(settings);
  expect(await metadata.namespaces.execute({ ...original, id: uuid(99) })).toEqual(organization);
  expect((await createSuite(metadata)).version).toBe(1);
});

it('admits at most two suite operations and preserves the reserved close slot', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path); await seed(metadata); const suite = await createSuite(metadata);
  const first = metadata.suites.getSuite({ scope, id: suite.id }); const second = metadata.suites.getSuite({ scope, id: suite.id });
  await expect(metadata.suites.getSuite({ scope, id: suite.id })).rejects.toMatchObject({ code: 'queue_full' });
  const closing = metadata.close(); await expect(metadata.suites.getSuite({ scope, id: suite.id })).rejects.toMatchObject({ code: 'closed' });
  await Promise.all([first, second, closing]); fixture.handles.delete(metadata);
});
