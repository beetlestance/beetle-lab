import { expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { migration011 } from '../../src/journal/migration011.js';
import { transaction } from '../../src/journal/sql.js';
import { MAX_RESOURCE_VALUE } from '../../src/admission/index.js';
import { legacy, legacyRow, stats } from './fixtures.js';

function unchangedOnFailure(db: DatabaseSync) {
  const before = JSON.stringify(db.prepare('SELECT * FROM accepted_attempts ORDER BY id').all());
  const reservations = JSON.stringify(db.prepare('SELECT * FROM reservations ORDER BY id').all());
  expect(() => transaction(db, () => migration011(db))).toThrow();
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(10);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'disk_%'").all()).toEqual([]);
  expect(db.prepare('PRAGMA table_info(accepted_attempts)').all().some(row => row.name === 'hold_bytes')).toBe(false);
  expect(JSON.stringify(db.prepare('SELECT * FROM accepted_attempts ORDER BY id').all())).toBe(before);
  expect(JSON.stringify(db.prepare('SELECT * FROM reservations ORDER BY id').all())).toBe(reservations);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}
it('migrates active and released originals at exact original quota fit, retaining staging and all disk debt', () => {
  const db = legacy(); const active = legacyRow(db); const released = legacyRow(db, 2, false);
  db.exec('UPDATE accepted_attempts SET quota_bytes=1024,snapshot_bytes=512');
  transaction(db, () => migration011(db));
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
  expect(stats(db)).toEqual({ id: 1, held_count: 2, held_output_bytes: 200,
    held_staging_bytes: active.resources.stagingBytes + released.resources.stagingBytes,
    retained_output_bytes: 100, retained_staging_bytes: released.resources.stagingBytes });
  expect(db.prepare('SELECT hold_bytes,quota_bytes FROM accepted_attempts').all())
    .toEqual([expect.objectContaining({ hold_bytes: 512, quota_bytes: 1024 }), expect.objectContaining({ hold_bytes: 512, quota_bytes: 1024 })]);
  expect(db.prepare('SELECT phase FROM disk_holds ORDER BY attempt_id').all()).toEqual([
    expect.objectContaining({ phase: 'active' }), expect.objectContaining({ phase: 'retained' })]);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('fails atomically for an original quota shortfall without expanding quota or dropping retained custody', () => {
  const db = legacy(); legacyRow(db, 1, false);
  db.exec('UPDATE accepted_attempts SET quota_bytes=1024,snapshot_bytes=513'); unchangedOnFailure(db);
});
it.each([
  "UPDATE reservations SET reservation_json=json_remove(reservation_json,'$.staging')",
  "UPDATE reservations SET reservation_json=json_remove(reservation_json,'$.resources.stagingBytes')",
  "UPDATE reservations SET reservation_json=json_set(reservation_json,'$.resources.outputBytes',1)",
  "UPDATE accepted_attempts SET intent_digest='missing'",
  "UPDATE accepted_attempts SET organization_id='missing'",
  'DELETE FROM admission_queue',
])('preserves the prior schema and data when trustworthy original metadata is missing: %s', query => {
  const db = legacy(); legacyRow(db); db.exec(query); unchangedOnFailure(db);
});
it('fails before migration for more than 4096 originals, including released originals', () => {
  const db = legacy(); transaction(db, () => { for (let id = 1; id <= 4097; id++) legacyRow(db, id, false); });
  unchangedOnFailure(db);
});
it('rejects all-held safe-integer overflow while preserving previously released debt', () => {
  const db = legacy(); transaction(db, () => { for (let id = 1; id <= 257; id++) legacyRow(db, id, false); });
  for (const table of ['admission_queue', 'reservations']) {
    const column = table === 'reservations' ? 'reservation_json' : 'candidate_json';
    db.exec(`UPDATE ${table} SET ${column}=json_set(${column},'$.resources.outputBytes',${MAX_RESOURCE_VALUE},'$.budget.outputBytes',${MAX_RESOURCE_VALUE})`);
  }
  unchangedOnFailure(db);
});
it('accepts the largest safe representable aggregate and full hold count without current pool authority', () => {
  const db = legacy(); transaction(db, () => { for (let id = 1; id <= 4096; id++) legacyRow(db, id, false); });
  const each = Math.floor(Number.MAX_SAFE_INTEGER / 4096);
  const remainder = Number.MAX_SAFE_INTEGER - each * 4096;
  for (const table of ['admission_queue', 'reservations']) {
    const column = table === 'reservations' ? 'reservation_json' : 'candidate_json';
    db.exec(`UPDATE ${table} SET ${column}=json_set(${column},'$.resources.outputBytes',${each},'$.budget.outputBytes',${each})`);
    db.prepare(`UPDATE ${table} SET ${column}=json_set(${column},'$.resources.outputBytes',?,'$.budget.outputBytes',?) WHERE id=4096`)
      .run(each + remainder, each + remainder);
  }
  // All rows are retained. The current small/default pool must never erase this debt.
  transaction(db, () => migration011(db));
  expect(stats(db)).toMatchObject({ held_count: 4096, held_output_bytes: Number.MAX_SAFE_INTEGER, retained_output_bytes: Number.MAX_SAFE_INTEGER });
});
