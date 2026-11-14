import {withMigratedCopy} from './historical-copy-fixture.js';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { migration001, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../src/adapters/outbound/sqlite/migration003.js';
import { migration004 } from '../../src/adapters/outbound/sqlite/migration004.js';
import { migration005 } from '../../src/adapters/outbound/sqlite/migration005.js';
import { migration006 } from '../../src/adapters/outbound/sqlite/migration006.js';
import { DispatchClaims } from '../../src/adapters/outbound/sqlite/dispatch-claims.js';
import { DispatchObservations } from '../../src/adapters/outbound/sqlite/dispatch-observations.js';
import { Settings } from '../../src/adapters/outbound/sqlite/settings.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { hasUntrackedOwnership } from '../../src/adapters/outbound/sqlite/execution-ownership.js';
import { reserveHistoricalOutput, seedFoundation, enqueue, acknowledge, snapshotFor } from './execution-foundation-fixtures.js';
import { settingsFixture, observation } from './fixture.js';
import { runOptions } from './runs-fixture.js';
import { custody } from './dispatch-claim-fixtures.js';

/** Construct the actual retained v5 schema, before any authority column exists. */
function legacy() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(migration001); db.exec(migration002); migrate003(db); db.exec(migration004); db.exec(migration005);
  const store = seedFoundation(db); const { key } = enqueue(db, store);
  transaction(db, () => {
    db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
      delivery_attempt_id,output_attempt_id) SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
      attempt_id,attempt_id FROM execution_intents WHERE attempt_id=?`).run(key.attempt.attemptId);
    reserveHistoricalOutput(db, key, Number.MAX_SAFE_INTEGER);
    db.prepare("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00.000Z'").run();
  });
  return { db, store, key };
}
it.each([false, true])('preserves actual v5 data and charge without adopting authority, acknowledged=%s', ack => {
  const { db, store, key } = legacy();
  try {
    const next = enqueue(db, store, 72).key;
    if (ack) transaction(db, () => acknowledge(db, key));
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
    const tables = ['runs', 'attempts', 'dispatch_outbox', 'execution_records', 'execution_intents',
      'attempt_output_allocations', 'installation_storage_usage', 'receipts'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    transaction(db, () => db.exec(migration006));
    tables.forEach((table, i) => {
      const rows = before[i]!;
      if (rows.length) expect(db.prepare(`SELECT ${Object.keys(rows[0]!).join(',')} FROM ${table}`).all()).toEqual(rows);
      else expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
    });
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(6);
    expect(db.prepare('SELECT journal_authority,execution_charged FROM execution_records').get())
      .toEqual({ journal_authority: null, execution_charged: 1 });
    expect(hasUntrackedOwnership(db)).toBe(true);
    withMigratedCopy(db, current => {
      const settings = settingsFixture(); const runtime = observation(settings.runtime);
      const claims = new DispatchClaims(current, new Settings(current, { installation: settings.chain.installation, runtime }), runOptions().runs!);
      const reads = new RunReads(current, new Suites(current, new Entities(current)));
      const observations = new DispatchObservations(current, reads);
      const retained = custody(current);
      expect(claims.claim(key)).toEqual({ kind: 'blocked', reason: 'ownership_unknown' });
      expect(claims.claim(next)).toEqual({ kind: 'blocked', reason: 'ownership_unknown' });
      expect(claims.scan({ lane: 'reconcile', limit: 1 }).items[0]?.eligibility)
        .toEqual({ kind: 'blocked', reason: 'ownership_unknown' });
      expect(() => observations.observe({ key, journalAuthority: runtime.journalAuthority, snapshot: snapshotFor(key) })).toThrow();
      expect(custody(current)).toEqual(retained);
    });
    const runtime = observation(settingsFixture().runtime); const retained = custody(db);
    expect(() => db.prepare('UPDATE execution_records SET journal_authority=?').run(runtime.journalAuthority)).toThrow();
    expect(() => db.exec('UPDATE execution_records SET execution_charged=0')).toThrow();
    expect(custody(db)).toEqual(retained);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('rolls back a late migration failure without partial authority schema or changed legacy custody', () => {
  const { db } = legacy();
  try {
    db.exec('CREATE INDEX execution_unbound_authority ON execution_records(attempt_id)');
    const before = custody(db);
    expect(() => transaction(db, () => db.exec(migration006))).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(5);
    expect(db.prepare('PRAGMA table_info(execution_records)').all().some(row => row.name === 'journal_authority')).toBe(false);
    expect(custody(db)).toEqual(before);
    db.exec('DROP INDEX execution_unbound_authority');
    transaction(db, () => db.exec(migration006));
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(6);
  } finally { db.close(); }
});
