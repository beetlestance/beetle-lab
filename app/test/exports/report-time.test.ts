import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { storageFixture, seed, scope, uuid } from '../storage/fixture.js';
import { createSuite, append, request } from '../storage/suites-fixture.js';
import { options, createCommand } from './fixture.js';
import { migration036 } from '../../src/adapters/outbound/sqlite/migration036.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';

const f = storageFixture();
it('retains backend receipt time only for changed accepted snapshots and preserves it on reopen', async () => {
  const path = f.path();
  const config = options();
  const metadata = await f.open(path, config);
  await seed(metadata);
  const body = request();
  body.config.secrets = [];
  const revision = await append(metadata, await createSuite(metadata), 60, body);
  const job = await metadata.exports.create(createCommand(revision.id));
  expect(job).toMatchObject({ madeAt: null, lastAgentReportAt: null });
  const key = { scope, id: job.id };
  const claim = await metadata.exportExecutions.claim(key);
  if (claim.kind === 'blocked' || !claim.control.binding) throw Error('Synthetic claim');
  const binding = claim.control.binding;
  const snapshot = {
    protocolVersion: '1.0' as const,
    ...binding.key.attempt,
    state: 'preparing' as const,
    phase: 'prepare' as const,
    lastSeq: 1,
    retainedStartSeq: 1,
    cancelRequested: false,
    admission: { state: 'charged' as const },
  };
  const report = { key, snapshot, journalAuthority: binding.journalAuthority };
  const first = await metadata.exportExecutions.observe(report);
  expect(first.lastAgentReportAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(await metadata.exportExecutions.observe(report)).toEqual(first);
  await expect(metadata.exportExecutions.observe({ ...report, journalAuthority: uuid(99) })).rejects.toMatchObject({
    code: 'conflict',
  });
  await expect(
    metadata.exportExecutions.observe({ ...report, snapshot: { ...snapshot, workspaceId: uuid(99) } }),
  ).rejects.toBeDefined();
  expect(await metadata.exports.get(key)).toEqual(first);
  const changed = await metadata.exportExecutions.observe({ ...report, snapshot: { ...snapshot, lastSeq: 2 } });
  expect(changed.version).toBeGreaterThan(first.version);
  expect(changed.lastAgentReportAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  await f.close(metadata);
  const reopened = await f.open(path, { readOnly: true, runtime: null });
  expect(await reopened.exports.get(key)).toEqual(changed);
});

it('adds nullable diagnostics to schema 35 without backfilling and rolls back a failed migration', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      "CREATE TABLE export_jobs(id TEXT PRIMARY KEY); INSERT INTO export_jobs VALUES('retained'); PRAGMA user_version=35",
    );
    transaction(db, () => db.exec(migration036));
    expect(db.prepare('SELECT * FROM export_jobs').get()).toEqual({ id: 'retained', last_agent_report_at: null });
    expect(() => db.exec("UPDATE export_jobs SET last_agent_report_at='invalid'")).toThrow();
    db.prepare('UPDATE export_jobs SET last_agent_report_at=?').run('2026-11-18T00:00:00.000Z');
    db.exec('PRAGMA user_version=35');
    expect(() => transaction(db, () => db.exec(migration036))).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(35);
    expect(db.prepare('SELECT last_agent_report_at FROM export_jobs').get()?.last_agent_report_at).toBe(
      '2026-11-18T00:00:00.000Z',
    );
  } finally {
    db.close();
  }
});
