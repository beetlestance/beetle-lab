import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { initialize, METADATA_SCHEMA_VERSION, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration039 } from '../../src/adapters/outbound/sqlite/migration039.js';
import { enqueue, seedFoundation } from '../storage/execution-foundation-fixtures.js';
import { shipped } from '../storage/legacy027.js';
import { rows } from '../storage/clock-reason/fixtures.js';

it('upgrades populated schema 38 with only the output evidence DDL changes and no data drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'beetle-stop-039-'));
  const path = join(root, 'metadata.sqlite');
  const old = shipped(38);
  const schema = (db: typeof old) => db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all();
  try {
    enqueue(old, seedFoundation(old, 4_000_000));
    const before = rows(old);
    const prior = schema(old);
    expect(() => transaction(old, () => old.exec(migration039 + 'SELECT * FROM missing_after_039;'))).toThrow();
    expect(old.prepare('PRAGMA user_version').get()?.user_version).toBe(38);
    expect(schema(old)).toEqual(prior);
    expect(rows(old)).toEqual(before);
    old.prepare('VACUUM INTO ?').run(path);
    const next = initialize(path);
    try {
      expect(next.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
      expect(
        rows(next).filter(
          (entry) => !['execution_stopped_history', 'execution_source_stopped_history'].includes(entry.name),
        ),
      ).toEqual(before);
      const changed = new Set([
        'output_finalization_evidence',
        'output_header_update',
        'output_absence_evidence',
        'execution_stopped_history',
        'stopped_history_insert',
        'stopped_history_update',
        'stopped_history_delete',
        'sqlite_autoindex_execution_stopped_history_1',
        'execution_source_stopped_history',
        'source_stopped_history_insert',
        'source_stopped_history_update',
        'source_stopped_history_delete',
        'sqlite_autoindex_execution_source_stopped_history_1',
      ]);
      expect(schema(next).filter((row) => !changed.has(String(row.name)))).toEqual(
        prior.filter((row) => !changed.has(String(row.name))),
      );
      expect(next.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
    } finally {
      next.close();
    }
  } finally {
    old.close();
    rmSync(root, { recursive: true, force: true });
  }
});
