import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { InputRecord } from '../../src/ports/inputs.js';
import { createInput, inputCommand, inputOptions, transition, trustedPublish } from './inputs-fixture.js';
import { storageFixture, seed, scope, uuid, requestId, command, settingsCommand } from './fixture.js';
import { append, createSuite, request } from './suites-fixture.js';

const fixture = storageFixture();
it('replays shared controls before guards, preserves original snapshots, and bounds intents to three', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, inputOptions()); await seed(metadata);
  const creation = createInput(); const original = await metadata.inputs.control(creation) as InputRecord;
  expect(original).toMatchObject({ id: uuid(90), name: 'Input 90', folderId: uuid(3), version: 1, state: 'staging', offset: 0, reason: null });
  const key = { scope, id: original.id };
  await expect(metadata.inputs.control(transition(original, 'sealInput'))).rejects.toMatchObject({ code: 'conflict' });
  const progress = await metadata.inputs.advance({ kind: 'commitInputOffset', key, expectedVersion: 1, offset: 12 });
  const seal = transition(progress, 'sealInput'); const receipt = await metadata.inputs.control(seal);
  expect(receipt).toMatchObject({ operation: 'seal', acceptedVersion: 3 });
  await expect(metadata.inputs.control(transition({ ...progress, version: 3 }, 'sealInput'))).rejects.toMatchObject({ code: 'conflict' });
  const published = await metadata.inputs.advance({ kind: 'publishInput', key, expectedVersion: 3 });
  expect(published).toMatchObject({ state: 'published', version: 4 });
  const deletion = transition(published, 'deleteInput'); const accepted = await metadata.inputs.control(deletion);
  expect(accepted).toMatchObject({ operation: 'delete', acceptedVersion: 5 });
  const failed = await metadata.inputs.advance({ kind: 'failInput', key, expectedVersion: 5, reason: 'io' });
  expect(failed).toMatchObject({ state: 'deleting', reason: 'io', version: 6 });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(65536 + 12);
  await expect(metadata.inputs.control(transition(failed, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.inputs.control(deletion)).toEqual(accepted);
  await fixture.close(metadata); metadata = await fixture.open(path, { ...inputOptions(), runtime: null });
  expect(await metadata.inputs.control({ ...creation, id: uuid(91) })).toEqual(original);
  expect(await metadata.inputs.control(seal)).toEqual(receipt);
  expect(await metadata.inputs.get(key)).toEqual(failed);
  const deleted = await metadata.inputs.advance({ kind: 'deleteInputBytes', key, expectedVersion: 6 });
  expect(deleted).toMatchObject({ state: 'deleted', reason: null, version: 7 });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(65536);
  await expect(metadata.inputs.advance({ kind: 'deleteInputBytes', key, expectedVersion: 7 })).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.inputs.control(deletion)).toEqual(accepted);
  const other = inputCommand({ kind: 'deleteInput', id: uuid(91), request: { ...deletion.request, requestId: creation.request.requestId } } as Parameters<typeof inputCommand>[0]);
  await expect(metadata.inputs.control(other)).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.namespaces.execute(command({ kind: 'createFolder', id: uuid(50), request: {
    scope, requestId: creation.request.requestId, name: 'Collision', parentFolderId: uuid(3) } }))).rejects.toMatchObject({ code: 'conflict' });
  await fixture.close(metadata);
  const db = new DatabaseSync(path);
  expect(db.prepare('SELECT count(*) AS n FROM receipts WHERE request_id IN (?,?,?)')
    .get(creation.request.requestId, seal.request.requestId, deletion.request.requestId)?.n).toBe(3);
  expect(db.prepare('SELECT count(*) AS n FROM input_blobs').get()?.n).toBe(1); db.close();
});
it('checks versions, progress, failed-state fences, scope and folders without allocating failed intents', async () => {
  const metadata = await fixture.open(undefined, inputOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const owner = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  const bad = createInput();
  await expect(metadata.inputs.control(inputCommand({ ...bad, request: { ...bad.request, folderId: uuid(13) } } as Parameters<typeof inputCommand>[0])))
    .rejects.toMatchObject({ code: 'not_found' });
  const input = await metadata.inputs.control(bad) as InputRecord; const key = { scope, id: input.id };
  await expect(metadata.inputs.get({ scope: owner, id: input.id })).rejects.toMatchObject({ code: 'not_found' });
  const wrong = { kind: 'commitInputOffset', key, expectedVersion: 1, offset: 13 } as const;
  await expect(metadata.inputs.advance(wrong)).rejects.toMatchObject({ code: 'conflict' });
  const races = await Promise.allSettled([metadata.inputs.advance({ ...wrong, offset: 6 }), metadata.inputs.advance({ ...wrong, offset: 7 })]);
  expect(races.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const partial = await metadata.inputs.get(key);
  await expect(metadata.inputs.advance({ ...wrong, expectedVersion: partial.version, offset: partial.offset })).rejects.toMatchObject({ code: 'conflict' });
  const failed = await metadata.inputs.advance({ kind: 'failInput', key, expectedVersion: partial.version, reason: 'integrity' });
  await expect(metadata.inputs.advance({ kind: 'publishInput', key, expectedVersion: failed.version })).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.inputs.advance({ ...wrong, expectedVersion: failed.version, offset: 12 })).rejects.toMatchObject({ code: 'conflict' });
  await expect(metadata.inputs.control(transition(failed, 'sealInput'))).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.inputs.control(transition(failed, 'deleteInput'))).toMatchObject({ operation: 'delete' });
});
it('reserves once across organizations, charges zero-byte tombstones, and retains charges through reductions', async () => {
  const total = 2 * 65536 + 100 + 1000;
  const metadata = await fixture.open(undefined, inputOptions(total)); await seed(metadata); await seed(metadata, 11, 12, 13);
  const owner = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  const first = createInput(90, 60); const second = createInput(91, 60, owner);
  const race = await Promise.allSettled([metadata.inputs.control(first), metadata.inputs.control(second)]);
  expect(race.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const winner = race.find(result => result.status === 'fulfilled')!;
  if (winner.status !== 'fulfilled') throw new Error('Expected admitted reservation');
  const input = winner.value as InputRecord;
  expect(await metadata.inputs.storage()).toMatchObject({ chargedBytes: 65596, allocationBytes: total, freeSpaceReserveBytes: 1000 });
  const empty = await metadata.inputs.control(createInput(92, 0)) as InputRecord;
  expect((await metadata.inputs.storage()).chargedBytes).toBe(131132);
  await expect(metadata.inputs.control(createInput(93, 0))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  const installation = await metadata.getSettings({ kind: 'installation' });
  await metadata.settings.execute(settingsCommand(installation.id, { scope: { kind: 'installation' }, schemaVersion: 2,
    requestId: requestId(), expectedVersion: 1, patch: { pool: { ...inputOptions(total).installation.values.pool, storageBytes: 4000 } } }));
  expect((await metadata.inputs.storage()).chargedBytes).toBe(131132);
  await expect(metadata.inputs.control(createInput(94, 0))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  await metadata.inputs.control(transition(input, 'deleteInput'));
  await metadata.inputs.advance({ kind: 'deleteInputBytes', key: { scope: input.scope, id: input.id }, expectedVersion: 2 });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(131072);
  await trustedPublish(metadata, empty);
});
it('counts configured reserve once as headroom, accepts empty seals and checks arithmetic overflow', async () => {
  const metadata = await fixture.open(undefined, inputOptions(2 * 65536 + 5000, 5000)); await seed(metadata);
  const a = await metadata.inputs.control(createInput(90, 0)) as InputRecord;
  await metadata.inputs.control(createInput(91, 0));
  expect((await metadata.inputs.storage()).chargedBytes).toBe(2 * 65536);
  await expect(metadata.inputs.control(createInput(92, 0))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  expect(await trustedPublish(metadata, a)).toMatchObject({ offset: 0, version: 3, state: 'published' });
  const path = fixture.path(); let huge = await fixture.open(path, inputOptions(Number.MAX_SAFE_INTEGER, 0)); await seed(huge); await fixture.close(huge);
  const db = initialize(path); db.prepare('UPDATE installation_storage_usage SET charged_bytes=?').run(Number.MAX_SAFE_INTEGER - 100); db.close();
  huge = await fixture.open(path, { ...inputOptions(Number.MAX_SAFE_INTEGER, 0), runtime: null });
  await expect(huge.inputs.control(createInput(90, 0))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  expect((await huge.inputs.storage()).chargedBytes).toBe(Number.MAX_SAFE_INTEGER - 100);
});
it('serializes historical revision pins and deletion intent in the same worker', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, inputOptions()); await seed(metadata);
  const suite = await createSuite(metadata); const input = await trustedPublish(metadata, await metadata.inputs.control(createInput()) as InputRecord);
  const body = request(); body.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu', input: { id: input.id, sha256: input.sha256, bytes: input.bytes } }];
  const race = await Promise.allSettled([append(metadata, suite, 60, body), metadata.inputs.control(transition(input, 'deleteInput'))]);
  expect(race.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(race[0]?.status).toBe('fulfilled');
  const current = await metadata.suites.getSuite({ scope, id: suite.id });
  await append(metadata, current, 61, request(2));
  await expect(metadata.inputs.control(transition(input, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
  await fixture.close(metadata); metadata = await fixture.open(path, { ...inputOptions(), runtime: null });
  await expect(metadata.inputs.control(transition(input, 'deleteInput'))).rejects.toMatchObject({ code: 'conflict' });
  const other = await trustedPublish(metadata, await metadata.inputs.control(createInput(91)) as InputRecord);
  await metadata.inputs.control(transition(other, 'deleteInput'));
  const latest = await metadata.suites.getSuite({ scope, id: suite.id }); const blocked = request(latest.version);
  blocked.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu', input: { id: other.id, sha256: other.sha256, bytes: other.bytes } }];
  await expect(append(metadata, latest, 62, blocked)).rejects.toMatchObject({ code: 'not_found' });
  await fixture.close(metadata); const db = new DatabaseSync(path);
  expect(db.prepare('SELECT count(*) AS n FROM revision_input_pins').get()?.n).toBe(1);
  expect(db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM revision_input_pins WHERE organization_id=? AND workspace_id=? AND input_id=?')
    .all(scope.organizationId, scope.workspaceId, input.id)).toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.stringContaining('input_pins_lookup') })])); db.close();
});
it('bounds scoped lists and recovery with query-bound cursors', async () => {
  const metadata = await fixture.open(undefined, inputOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  for (let id = 90; id < 94; id++) await metadata.inputs.control(createInput(id));
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  await metadata.inputs.control(createInput(90, 0, foreign));
  const first = await metadata.inputs.list({ scope, limit: 2 }); expect(first.items).toHaveLength(2);
  const second = await metadata.inputs.list({ scope, limit: 2, cursor: first.nextCursor! });
  expect(second.items.map(input => input.id)).toEqual([uuid(92), uuid(93)]); expect(second.nextCursor).toBeNull();
  await expect(metadata.inputs.list({ scope: foreign, limit: 2, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.list({ scope, limit: 1, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
  const page = await metadata.inputs.recovery({ limit: 3 }); expect(page.items).toHaveLength(3);
  const tail = await metadata.inputs.recovery({ limit: 3, cursor: page.nextCursor! }); expect(tail.items).toHaveLength(2);
  expect(new Set([...page.items, ...tail.items].map(input => `${input.scope.organizationId}:${input.id}`)).size).toBe(5);
  await expect(metadata.inputs.recovery({ limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
});
it('validates bounded controls/advances before messaging and recomputes intent instead of trusting caller digests', async () => {
  const metadata = await fixture.open(undefined, inputOptions()); await seed(metadata);
  const valid = createInput();
  await expect(metadata.inputs.control({ ...valid, intentDigest: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.control({ ...valid, request: { ...valid.request, unexpected: 'x' } } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  let invoked = false;
  const accessor = Object.defineProperty({ ...valid }, 'request', { enumerable: true, get() { invoked = true; throw new Error('private'); } });
  await expect(metadata.inputs.control(accessor)).rejects.toMatchObject({ code: 'invalid_input' }); expect(invoked).toBe(false);
  for (const bytes of [-1, 0.5, 8388609, Number.MAX_SAFE_INTEGER]) {
    await expect(metadata.inputs.control({ ...valid, request: { ...valid.request, bytes } } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  }
  await expect(metadata.inputs.list({ scope, limit: 101 })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.recovery({ limit: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
  const record = await metadata.inputs.control(valid) as InputRecord;
  await expect(metadata.inputs.advance({ kind: 'failInput', key: { scope, id: record.id }, expectedVersion: 1, reason: 'secret-path' } as never))
    .rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.control(createInput(90))).rejects.toMatchObject({ code: 'conflict' });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(65548);
});
