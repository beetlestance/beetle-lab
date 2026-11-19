import { expect, it } from 'vitest';
import { initialize as prior023 } from '../backend-settlement/prior023.js';
import { migration024 } from '../../src/adapters/outbound/sqlite/migration024.js';
import { migrate025 } from '../../src/adapters/outbound/sqlite/migration025.js';
import { migration026 } from '../../src/adapters/outbound/sqlite/migration026.js';
import { migration027 } from '../../src/adapters/outbound/sqlite/migration027.js';
import { migration028 } from '../../src/adapters/outbound/sqlite/migration028.js';
import { migration029 } from '../../src/adapters/outbound/sqlite/migration029.js';
import { migration030 } from '../../src/adapters/outbound/sqlite/migration030.js';
import { migration031 } from '../../src/adapters/outbound/sqlite/migration031.js';
import { migration032 } from '../../src/adapters/outbound/sqlite/migration032.js';
import { migration033 } from '../../src/adapters/outbound/sqlite/migration033.js';
import { migration034 } from '../../src/adapters/outbound/sqlite/migration034.js';
import { migration035 } from '../../src/adapters/outbound/sqlite/migration035.js';
import { migration036 } from '../../src/adapters/outbound/sqlite/migration036.js';
import { migration037 } from '../../src/adapters/outbound/sqlite/migration037.js';
import { registerBackendSettlement } from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import { registerRetentionAccounting } from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { graph, rows } from './clock-reason/fixtures.js';
import { seedFoundation, enqueue } from './execution-foundation-fixtures.js';
import { readRunNote } from '../../src/adapters/outbound/sqlite/run-annotations.js';
function prior036() {
  const db = prior023(':memory:');
  registerBackendSettlement(db); registerRetentionAccounting(db);
  transaction(db, () => db.exec(migration024)); transaction(db, () => migrate025(db));
  for (const sql of [migration026,migration027,migration028,migration029,migration030,migration031,
    migration032,migration033,migration034,migration035,migration036]) transaction(db, () => db.exec(sql));
  const { run } = enqueue(db, seedFoundation(db));
  db.prepare('INSERT INTO run_notes(run_id,organization_id,workspace_id,version,note) VALUES(?,?,?,1,?)')
    .run(run.id,run.scope.organizationId,run.scope.workspaceId,'Existing note');
  return { db, run };
}
it('adds only a null timestamp to a populated schema036 and validates future stamps on read', () => {
  const { db, run } = prior036();
  try {
    const before = rows(db);
    transaction(db, () => db.exec(migration037));
    const after = rows(db).map(table => table.name !== 'run_notes' ? table : {
      ...table, rows: table.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updated_at'))),
    });
    expect(after).toEqual(before);
    expect(readRunNote(db,run)).toEqual({note:'Existing note',noteVersion:1,noteUpdatedAt:null});
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(37);
    db.prepare('UPDATE run_notes SET version=2,updated_at=?').run('not a real timestamp'.padEnd(24,'x'));
    expect(() => readRunNote(db,run)).toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('rolls back the exact predecessor schema and all rows after a late migration failure', () => {
  const { db } = prior036();
  try {
    const originalGraph = graph(db); const originalRows = rows(db);
    expect(() => transaction(db, () => { db.exec(migration037); throw Error('synthetic late failure'); })).toThrow('late failure');
    expect(graph(db)).toEqual(originalGraph); expect(rows(db)).toEqual(originalRows);
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(36);
  } finally { db.close(); }
});
