import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration038 } from '../../src/adapters/outbound/sqlite/migration038.js';
import { seedFoundation, enqueue } from '../storage/execution-foundation-fixtures.js';
import { shipped } from '../storage/legacy027.js';
import { rows } from '../storage/clock-reason/fixtures.js';

function graph(db: Parameters<typeof rows>[0]) {
  return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name').all();
}

it('classifies every real runs column, exempting only the two derived history fields', () => {
  const db = initialize(':memory:');
  try {
    const sql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE name='retention_run_update'").get()?.sql);
    const clause = /AFTER UPDATE OF ([\s\S]*?) ON runs/.exec(sql)?.[1];
    expect(clause).toBeDefined();
    const guarded = clause!.split(',').map((name) => name.trim());
    const columns = db
      .prepare('PRAGMA table_info(runs)')
      .all()
      .map((row) => String(row.name));
    expect([...guarded, 'history_summary_json', 'history_summary_due_ms'].sort()).toEqual(columns.sort());
    expect(new Set(guarded).size).toBe(guarded.length);
  } finally {
    db.close();
  }
});

it('upgrades populated shipped schema 37 with no row, receipt or accounting drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'beetle-retention-038-'));
  const path = join(root, 'metadata.sqlite');
  const prior = shipped(37);
  try {
    const store = seedFoundation(prior, 4_000_000);
    enqueue(prior, store);
    expect(prior.prepare('PRAGMA user_version').get()?.user_version).toBe(37);
    const before = rows(prior);
    const schema = graph(prior);
    expect(before.find((table) => table.name === 'receipts')?.rows.length).toBeGreaterThan(0);
    expect(prior.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBeGreaterThan(
      0,
    );
    prior.prepare('VACUUM INTO ?').run(path);
    prior.close();
    const upgraded = initialize(path);
    try {
      expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(38);
      expect(rows(upgraded)).toEqual(before);
      expect(graph(upgraded).filter((row) => row.name !== 'retention_run_update')).toEqual(
        schema.filter((row) => row.name !== 'retention_run_update'),
      );
      expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(upgraded.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    } finally {
      upgraded.close();
    }
  } finally {
    if (prior.isOpen) prior.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('rolls a late migration failure back with the original trigger, version and every retained row', () => {
  const db = shipped(37);
  try {
    const store = seedFoundation(db, 4_000_000);
    enqueue(db, store);
    const before = rows(db);
    const schema = graph(db);
    expect(() => transaction(db, () => db.exec(migration038 + '\nSELECT * FROM missing_migration_038;'))).toThrow();
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(37);
    expect(rows(db)).toEqual(before);
    expect(graph(db)).toEqual(schema);
  } finally {
    db.close();
  }
});
