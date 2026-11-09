import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { scope, seed, storageFixture, uuid, requestId, settingsCommand, command as namespaceCommand } from './fixture.js';
import { append, createSuite, largeConfig, request } from './suites-fixture.js';
import { runCommand, runOptions, runRequest } from './runs-fixture.js';

const fixture = storageFixture();
it('atomically persists run/attempt/outbox and replays original receipt after settings, registry and capacity change', async () => {
  const path = fixture.path(); const options = runOptions(); let metadata = await fixture.open(path, options); await seed(metadata);
  const body = request(); body.config.secrets = [{ name: '_TOKEN', provider: 'env', locator: '_SOURCE', version: 'v2' }];
  const revision = await append(metadata, await createSuite(metadata), 60, body);
  const command = runCommand(revision.id); const run = await metadata.runs.execute(command);
  expect(run).toMatchObject({ id: uuid(70), activeAttemptId: uuid(170), state: 'queued', outcome: 'pending', validationStatus: 'pending',
    settingsVersions: { installation: 1, organization: 1, workspace: 1 } });
  expect(await metadata.runs.getRun({ scope, id: run.id })).toEqual(run);
  const orgSettings = await metadata.getSettings({ kind: 'organization', organizationId: uuid(1) });
  await metadata.settings.execute(settingsCommand(orgSettings.id, { scope: { kind: 'organization', organizationId: uuid(1) },
    schemaVersion: 2, requestId: requestId(), expectedVersion: 1, patch: { runDefaults: { budget: { cpuMillis: 90 } } } }));
  await fixture.close(metadata);
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
  for (const table of ['runs', 'attempts', 'dispatch_outbox']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(1);
  const attempt = db.prepare('SELECT * FROM attempts').get()!; const offer = JSON.parse(String(attempt.offer_json)) as Offer;
  expect(validate('Offer', offer).ok).toBe(true);
  expect(offer.installedIdentity).toEqual(options.runs!.profiles[0]!.installedIdentity);
  expect(offer).toMatchObject({ attemptId: uuid(170), organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    config: revision.config, budget: run.budget, engine: { id: 'k6', imageDigest: run.engine.imageDigest, configVersion: 1 },
    secretReferences: [{ name: '_TOKEN', provider: 'env', reference: '_SOURCE', version: 'v2' }] });
  expect(db.prepare('SELECT * FROM dispatch_outbox').get()).toMatchObject({ attempt_id: uuid(170), intent_digest: offer.intentDigest,
    possible_delivery: 0, first_delivery_at: null, next_offer_at_ms: 0 });
  expect(JSON.parse(String(attempt.registry_json))).toEqual(options.runs!.profiles[0]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
  metadata = await fixture.open(path, { runtime: null, runs: { profiles: [], pendingLimit: 1 } });
  expect(await metadata.runs.execute(runCommand(revision.id, 71, command.request))).toEqual(run);
  await expect(metadata.runs.execute(runCommand(revision.id, 72))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  await expect(metadata.runs.execute(runCommand(revision.id, 73, { ...command.request, executionPolicy: { mode: 'isolated', preferIdle: false } })))
    .rejects.toMatchObject({ code: 'conflict' });
});
it('enforces a global pending queue atomically while preserving scoped pages and receipt collisions', async () => {
  const metadata = await fixture.open(undefined, runOptions(2)); await seed(metadata); await seed(metadata, 11, 12, 13);
  const revision = await append(metadata, await createSuite(metadata));
  const outcomes = await Promise.allSettled([70, 71, 72].map(id => metadata.runs.execute(runCommand(revision.id, id))));
  expect(outcomes.map(value => value.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
  expect(outcomes[2]).toMatchObject({ reason: { code: 'queue_full' } });
  const page = await metadata.runs.listRuns({ scope, limit: 1 });
  expect(page.items.map(run => run.id)).toEqual([uuid(70)]); expect(page.nextCursor).not.toBeNull();
  const next = await metadata.runs.listRuns({ scope, limit: 1, cursor: page.nextCursor! });
  expect(next.items.map(run => run.id)).toEqual([uuid(71)]); expect(next.nextCursor).toBeNull();
  await expect(metadata.runs.listRuns({ scope, limit: 2, cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  await expect(metadata.runs.getRun({ scope: foreign, id: uuid(70) })).rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.runs.listRuns({ scope: foreign, limit: 1, cursor: page.nextCursor! })).rejects.toMatchObject({ code: 'invalid_input' });
  const collision = requestId();
  await metadata.namespaces.execute(namespaceCommand({ kind: 'createFolder', id: uuid(90), request: {
    scope, requestId: collision, name: 'Receipt owner', parentFolderId: uuid(3) } }));
  await expect(metadata.runs.execute(runCommand(revision.id, 75, { ...runRequest(revision.id), requestId: collision })))
    .rejects.toMatchObject({ code: 'conflict' });
  expect((await metadata.runs.listRuns({ scope, limit: 100 })).items).toHaveLength(2);
});
it('rolls back a late outbox insert failure with no partial rows or receipt, then accepts exact retry', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata)); const command = runCommand(revision.id);
  await fixture.close(metadata); let db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON dispatch_outbox BEGIN SELECT RAISE(ABORT,'synthetic'); END;"); db.close();
  metadata = await fixture.open(path, runOptions());
  await expect(metadata.runs.execute(command)).rejects.toMatchObject({ code: 'conflict' }); await fixture.close(metadata);
  db = new DatabaseSync(path);
  for (const table of ['runs', 'attempts', 'dispatch_outbox']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  expect(db.prepare('SELECT * FROM receipts WHERE request_id=?').get(command.request.requestId)).toBeUndefined();
  db.exec('DROP TRIGGER reject_outbox'); db.close(); metadata = await fixture.open(path, runOptions());
  expect(await metadata.runs.execute(command)).toMatchObject({ id: command.id, activeAttemptId: command.attemptId });
});
it('stores the complete one MiB UTF8 revision as a bounded immutable Offer through reopen', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const body = request(); body.config = largeConfig();
  const revision = await append(metadata, await createSuite(metadata), 60, body);
  const run = await metadata.runs.execute(runCommand(revision.id)); await fixture.close(metadata);
  const db = new DatabaseSync(path); const row = db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(run.activeAttemptId)!;
  const text = String(row.offer_json); const offer = JSON.parse(text) as Offer;
  expect(Buffer.byteLength(JSON.stringify(offer.config))).toBe(1048576);
  expect(Buffer.byteLength(text)).toBeGreaterThan(1048576); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(2097152);
  expect(offer.config).toEqual(revision.config);
  expect(() => db.prepare('UPDATE attempts SET offer_json=? WHERE id=?').run(text, run.activeAttemptId)).toThrow();
  expect(() => db.prepare('UPDATE runs SET snapshot_json=snapshot_json WHERE id=?').run(run.id)).toThrow(); db.close();
  const reopened = await fixture.open(path, { runtime: null });
  expect(await reopened.runs.getRun({ scope, id: run.id })).toEqual(run);
});
