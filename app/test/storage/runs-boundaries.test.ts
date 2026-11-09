import { createInput, inputOptions, trustedPublish } from './inputs-fixture.js';
import type { InputRecord } from '../../src/ports/inputs.js';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { scope, seed, storageFixture, uuid } from './fixture.js';
import { append, createSuite, request } from './suites-fixture.js';
import { runCommand, runOptions, runRequest } from './runs-fixture.js';

const fixture = storageFixture();
it('rejects wrong namespace/revision, budgets, profiles and unknown capacity without partial enqueue', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, runOptions()); await seed(metadata); await seed(metadata, 11, 12, 13);
  const revision = await append(metadata, await createSuite(metadata)); const original = runRequest(revision.id);
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  const cases = [
    { body: { ...original, scope: foreign }, code: 'not_found' },
    { body: { ...original, revisionId: uuid(999) }, code: 'not_found' },
    { body: { ...original, budget: { ...original.budget, cpuMillis: 1001 } }, code: 'invalid_value' },
    { body: { ...original, engineProfile: 'unknown' }, code: 'invalid_value' },
    { body: { ...original, engineProfile: 'isolated' }, code: 'capacity_unavailable' },
  ];
  for (const { body, code } of cases) await expect(metadata.runs.execute(runCommand(revision.id, 70, body))).rejects.toMatchObject({ code });
  await metadata.updateRuntime(null);
  await expect(metadata.runs.execute(runCommand(revision.id))).rejects.toMatchObject({ code: 'capacity_unavailable' });
  await fixture.close(metadata); const db = new DatabaseSync(path);
  for (const table of ['runs', 'attempts', 'dispatch_outbox']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  expect(db.prepare('SELECT * FROM receipts WHERE request_id=?').get(original.requestId)).toBeUndefined(); db.close();
});
it('rejects unsupported secret references after saved structural revision preflight without resolving them', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const body = request(); body.config.secrets = [{ name: 'TOKEN', provider: 'vault', locator: 'synthetic-alias' }];
  const revision = await append(metadata, await createSuite(metadata), 60, body);
  await expect(metadata.runs.execute(runCommand(revision.id))).rejects.toMatchObject({ code: 'invalid_value' });
  expect((await metadata.runs.listRuns({ scope, limit: 10 })).items).toEqual([]);
});
it('snapshots private registry input and rejects incompatible/ambiguous registrations before worker creation', async () => {
  const options = runOptions(); const metadata = await fixture.open(undefined, options); await seed(metadata);
  options.runs!.profiles[0]!.engine.imageDigest = `sha256:${'d'.repeat(64)}`;
  const revision = await append(metadata, await createSuite(metadata));
  expect((await metadata.runs.execute(runCommand(revision.id))).engine.imageDigest).toBe(`sha256:${'a'.repeat(64)}`);
  const bad = runOptions(); bad.runs!.profiles[0]!.installedIdentity.schemaDigest = 'd'.repeat(64);
  await expect(fixture.open(undefined, bad)).rejects.toMatchObject({ code: 'invalid_input' });
  const duplicate = runOptions(); const pin = duplicate.runs!.profiles[0]!;
  duplicate.runs = { pendingLimit: 2, profiles: [pin, { ...pin, engine: { ...pin.engine, profileId: 'alias' } }] };
  await expect(fixture.open(undefined, duplicate)).rejects.toMatchObject({ code: 'invalid_input' });
});
it('rejects tampered commands at worker ingress before durable receipt or allocation', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata)); const original = runCommand(revision.id);
  await expect(metadata.runs.execute({ ...original, intentDigest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_input' });
  const changed = runCommand(revision.id, 90, original.request);
  expect(changed.intentDigest).toBe(original.intentDigest);
  expect((await metadata.runs.execute(original)).id).toBe(original.id);
});

it('counts pending work across organisations within one installation queue', async () => {
  const metadata = await fixture.open(undefined, runOptions(1)); await seed(metadata); await seed(metadata, 11, 12, 13);
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  const first = await append(metadata, await createSuite(metadata));
  const foreignSuite = await createSuite(metadata, 51, foreign);
  const foreignRequest = { ...request(), scope: foreign };
  const second = await append(metadata, foreignSuite, 61, foreignRequest);
  await metadata.runs.execute(runCommand(first.id));
  await expect(metadata.runs.execute(runCommand(second.id, 71, { ...runRequest(second.id), scope: foreign })))
    .rejects.toMatchObject({ code: 'queue_full' });
  expect((await metadata.runs.listRuns({ scope: foreign, limit: 10 })).items).toEqual([]);
});

it('rechecks published pins for new requests while preserving an original receipt after custody failure', async () => {
  const metadata = await fixture.open(undefined, { ...inputOptions(), ...runOptions() }); await seed(metadata);
  await trustedPublish(metadata, await metadata.inputs.control(createInput(90, 12)) as InputRecord);
  const pin = await metadata.inputs.get({ scope, id: uuid(90) });
  const body = request(); body.config.datasets = [{ id: 'data', kind: 'json', selection: 'byVu',
    input: { id: pin.id, sha256: pin.sha256, bytes: pin.bytes } }];
  const revision = await append(metadata, await createSuite(metadata), 60, body);
  const original = runCommand(revision.id); const accepted = await metadata.runs.execute(original);
  await metadata.inputs.advance({ kind: 'failInput', key: { scope, id: pin.id }, expectedVersion: pin.version, reason: 'integrity' });
  expect(await metadata.runs.execute(original)).toEqual(accepted);
  await expect(metadata.runs.execute(runCommand(revision.id, 71))).rejects.toMatchObject({ code: 'not_found' });
});
