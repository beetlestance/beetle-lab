import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { prepareExportCommand, prepareExportCancellation } from '../../src/application/exports/index.js';
import { latestRevisionExportSql } from '../../src/adapters/outbound/sqlite/export-jobs/reads.js';
import { migration035 } from '../../src/adapters/outbound/sqlite/migration035.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { storageFixture, seed, scope, uuid, requestId, digest } from '../storage/fixture.js';
import { createSuite, append, request } from '../storage/suites-fixture.js';
import { options, createCommand } from './fixture.js';

const f = storageFixture();
it('finds a revision outside the workspace page and chooses latest acceptance despite reversed UUIDs and clocks', async () => {
  const config = options();
  config.installation!.values.pool.storageBytes = 536870912;
  config.runtime!.ceilings.pool.storageBytes = 1073741824;
  const path = f.path();
  const metadata = await f.open(path, config);
  await seed(metadata);
  await seed(metadata, 11, 12, 13);
  const body = request();
  body.config.secrets = [];
  const suite = await createSuite(metadata);
  const revision = await append(metadata, suite, 60, body);
  const other = await append(metadata, suite, 61, { ...body, requestId: requestId(), expectedVersion: 2 });
  expect(other.id).not.toBe(revision.id);
  expect(await metadata.exports.latest({ scope, id: revision.id })).toEqual({
    scope,
    revisionId: revision.id,
    job: null,
  });
  const first = await metadata.exports.create(createCommand(revision.id, 900));
  for (let id = 200; id <= 300; id++) await metadata.exports.create(createCommand(other.id, id));
  expect((await metadata.exports.list({ scope, limit: 100 })).items.some((job) => job.id === first.id)).toBe(false);
  expect((await metadata.exports.latest({ scope, id: revision.id })).job?.id).toBe(first.id);
  const prior = createCommand(revision.id, 100);
  const second = await metadata.exports.create(
    prepareExportCommand({ ...prior, requestedAt: '2026-11-01T00:00:00.000Z' }, digest),
  );
  expect((await metadata.exports.latest({ scope, id: revision.id })).job).toEqual(second);
  const cancelled = await metadata.exports.cancel(
    prepareExportCancellation(
      { kind: 'cancelExport', id: second.id, request: { scope, requestId: requestId() } },
      digest,
    ),
  );
  expect((await metadata.exports.latest({ scope, id: revision.id })).job).toEqual(cancelled);
  await expect(
    metadata.exports.latest({ scope: { ...scope, organizationId: uuid(11), workspaceId: uuid(12) }, id: revision.id }),
  ).rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.exports.latest({ scope, id: uuid(999) })).rejects.toMatchObject({ code: 'not_found' });
  await f.close(metadata);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${latestRevisionExportSql}`)
      .all(scope.organizationId, scope.workspaceId, revision.id);
    expect(plan.map((row) => row.detail).join(' ')).toContain('exports_revision_latest');
    expect(plan.map((row) => row.detail).join(' ')).not.toContain('TEMP B-TREE');
  } finally {
    db.close();
  }
  const archive = await f.open(path, { readOnly: true, runtime: null });
  expect((await archive.exports.latest({ scope, id: revision.id })).job).toEqual(cancelled);
});

it('adds the index to schema 34 without changing exports and rolls back a failed index migration', async () => {
  const path = f.path();
  const metadata = await f.open(path, options());
  await seed(metadata);
  const body = request();
  body.config.secrets = [];
  const revision = await append(metadata, await createSuite(metadata), 60, body);
  const job = await metadata.exports.create(createCommand(revision.id));
  await f.close(metadata);
  const old = new DatabaseSync(path);
  try {
    old.exec(
      'ALTER TABLE export_jobs DROP COLUMN last_agent_report_at; DROP INDEX exports_revision_latest; PRAGMA user_version=34;',
    );
  } finally {
    old.close();
  }
  const upgraded = await f.open(path, options());
  expect((await upgraded.exports.latest({ scope, id: revision.id })).job).toEqual(job);
  await f.close(upgraded);
  const failed = new DatabaseSync(path);
  try {
    failed.exec(
      'ALTER TABLE export_jobs DROP COLUMN last_agent_report_at; DROP INDEX exports_revision_latest; PRAGMA user_version=34; CREATE INDEX exports_revision_latest ON organizations(name);',
    );
    expect(() => transaction(failed, () => failed.exec(migration035))).toThrow();
    expect(failed.prepare('PRAGMA user_version').get()?.user_version).toBe(34);
    expect(failed.prepare('SELECT COUNT(*) AS n FROM export_jobs').get()?.n).toBe(1);
  } finally {
    failed.close();
  }
});
