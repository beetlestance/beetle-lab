import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './fixture.js';
import { initialize as prior023 } from './prior023.js';
import { enqueue, seedFoundation } from '../storage/execution-foundation-fixtures.js';
import { asSchema23 } from './legacy023.js';
import { rows, graph } from '../storage/clock-reason/fixtures.js';
import { migration024 } from '../../src/adapters/outbound/sqlite/migration024.js';
import { initialize, transaction, METADATA_SCHEMA_VERSION } from '../../src/adapters/outbound/sqlite/schema.js';
import { storageFixture } from '../storage/fixture.js';
const storage = storageFixture();
it('adds24 without altering populated prior rows or charges and reopens the same permanent identity', () => {
  const prior = prior023(':memory:');
  try {
    enqueue(prior, seedFoundation(prior, 4_000_000));
    const before = rows(prior);
    transaction(prior, () => prior.exec(migration024));
    expect(rows(prior).filter((row) => !['backend_retired_runs', 'backend_replay_storage'].includes(row.name))).toEqual(
      before,
    );
    expect(prior.prepare('SELECT * FROM backend_replay_storage').get()).toEqual({
      id: 1,
      original_count: 0,
      charged_bytes: 0,
    });
    const path = storage.path();
    prior.prepare('VACUUM INTO ?').run(path);
    let db = initialize(path);
    db.close();
    db = initialize(path);
    try {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(METADATA_SCHEMA_VERSION);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  } finally {
    prior.close();
  }
});
it('rolls back a late migration collision to exact23 schema and rows', () => {
  const prior = prior023(':memory:');
  try {
    enqueue(prior, seedFoundation(prior, 4_000_000));
    prior.exec('CREATE TABLE backend_replay_storage(collision TEXT)');
    const before = rows(prior);
    const schema = graph(prior);
    expect(() => transaction(prior, () => prior.exec(migration024))).toThrow();
    expect(rows(prior)).toEqual(before);
    expect(graph(prior)).toEqual(schema);
    expect(prior.prepare('PRAGMA user_version').get()?.user_version).toBe(23);
  } finally {
    prior.close();
  }
});
it('refuses to rewind committed settlement or newer schemas', () => {
  const f = fixture();
  f.settle();
  expect(() => asSchema23(f.db)).toThrow('settlement data');
  const path = storage.path();
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA user_version=${METADATA_SCHEMA_VERSION + 1};CREATE TABLE canary(v);INSERT INTO canary VALUES(7)`);
  db.close();
  expect(() => initialize(path)).toThrow('schema_newer');
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    expect(raw.prepare('SELECT v FROM canary').get()?.v).toBe(7);
  } finally {
    raw.close();
  }
});
