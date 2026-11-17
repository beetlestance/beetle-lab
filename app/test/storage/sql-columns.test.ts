import { sqlTextColumn, sqlIntegerColumn } from '../../src/adapters/outbound/sqlite/sql-columns.js';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
it('bounds stored text bytes and preserves genuine nullable values', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE cells(value)');
    const insert = db.prepare('INSERT INTO cells VALUES(?)');
    for (const value of [null, '界', '界界', Buffer.alloc(1000000), 12]) insert.run(value);
    expect(
      db
        .prepare(`SELECT ${sqlTextColumn('value', 4, true)} FROM cells`)
        .all()
        .map((row) => row.value),
    ).toEqual([null, '界', '', '', '']);
  } finally {
    db.close();
  }
});
it('rejects wrong numeric types before crossing the native boundary and distinguishes null corruption', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE cells(value INTEGER)');
    const insert = db.prepare('INSERT INTO cells VALUES(?)');
    for (const value of [null, 0, 12, -1, 1.5, 'X'.repeat(1000000), Buffer.alloc(1000000), 9007199254740992])
      insert.run(value);
    expect(
      db
        .prepare(`SELECT ${sqlIntegerColumn('value')} FROM cells`)
        .all()
        .map((row) => row.value),
    ).toEqual([null, 0, 12, null, null, null, null, null]);
    expect(
      db
        .prepare(`SELECT ${sqlIntegerColumn('value', true)} FROM cells`)
        .all()
        .map((row) => row.value),
    ).toEqual([null, 0, 12, -1, -1, -1, -1, -1]);
  } finally {
    db.close();
  }
});
it('refuses nonidentifier projection fragments', () => {
  expect(() => sqlTextColumn('id; DELETE FROM cells', 36)).toThrow();
  expect(() => sqlIntegerColumn('id', false, 'a.;')).toThrow();
});
