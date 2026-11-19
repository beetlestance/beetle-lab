import { expect, it } from 'vitest';
import type { NormalizedSuiteListQuery } from '@beetle/contracts/api';
import { migration034 } from '../../src/adapters/outbound/sqlite/migration034.js';
import { transaction } from '../../src/adapters/outbound/sqlite/transaction.js';
import { storedGroups, suiteGroupStatement } from '../../src/adapters/outbound/sqlite/suite-list/index.js';
import {
  folderGroupCountSql,
  folderNewestSql,
  subfolderCountSql,
} from '../../src/adapters/outbound/sqlite/suite-list/folders.js';
import { asSchema33 } from './legacy030.js';
import { suiteListFixture, time } from './suite-list-fixture.js';
import { scope, uuid } from './fixture.js';

function populated() {
  const f = suiteListFixture();
  f.suite(51, 'Alpha', 90, 61);
  f.suite(52, 'Beta', 90, 62);
  f.suite(53, 'Gamma', 90);
  f.run(61, 70, 1);
  f.run(61, 72, 1);
  f.run(62, 71, 2);
  f.run(60, 73, 3);
  f.db.prepare("UPDATE runs SET state='errored',outcome='inconclusive',reason='execution_lost' WHERE id=?").run(uuid(71));
  return f;
}
const derived = (f: ReturnType<typeof suiteListFixture>) => ({
  suites: f.db.prepare('SELECT id,latest_run_id,latest_requested_at,latest_group FROM suites ORDER BY id').all(),
  counts: f.db.prepare('SELECT revision_id,run_count FROM suite_revision_run_counts ORDER BY revision_id').all(),
});

it('upgrades schema33 rows: backfills latest retained Runs, groups and revision Run counts', () => {
  const f = populated();
  try {
    const expected = derived(f);
    expect(expected.suites).toEqual([
      { id: uuid(50), latest_run_id: uuid(73), latest_requested_at: time(3), latest_group: 'in_progress' },
      { id: uuid(51), latest_run_id: uuid(72), latest_requested_at: time(1), latest_group: 'in_progress' },
      { id: uuid(52), latest_run_id: uuid(71), latest_requested_at: time(2), latest_group: 'stopped' },
      { id: uuid(53), latest_run_id: null, latest_requested_at: '', latest_group: 'no_revision' },
    ]);
    const before = f.list({});
    asSchema33(f.db);
    const columns = f.db.prepare("SELECT name FROM pragma_table_info('suites') WHERE name LIKE 'latest%'").all();
    expect(columns).toEqual([]);
    expect(f.db.prepare("SELECT name FROM pragma_table_info('run_notes') WHERE name='updated_at'").all()).toEqual([]);
    expect(f.db.prepare("SELECT name FROM pragma_table_info('export_jobs') WHERE name='last_agent_report_at'").all()).toEqual([]);
    expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='exports_revision_latest'").all()).toEqual([]);
    transaction(f.db, () => f.db.exec(migration034));
    expect(f.db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 34 });
    expect(derived(f)).toEqual(expected);
    expect(f.list({})).toEqual(before);
    expect(f.revision(61).runCount).toBe(2);
  } finally {
    f.db.close();
  }
});

it('refuses to project recorded note times without changing the fixture', () => {
  const f = populated();
  try {
    f.db.prepare(`INSERT INTO run_notes(run_id,organization_id,workspace_id,version,note,updated_at)
      VALUES(?,?,?,1,?,?)`).run(uuid(71), scope.organizationId, scope.workspaceId, 'Recorded note', time(4));
    const before = f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
    const version = f.db.prepare('PRAGMA user_version').get();
    expect(() => asSchema33(f.db)).toThrow('Cannot project recorded note edit time');
    expect(f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(before);
    expect(f.db.prepare('PRAGMA user_version').get()).toEqual(version);
    expect(f.db.prepare('SELECT note,updated_at FROM run_notes').all()).toEqual([
      { note: 'Recorded note', updated_at: time(4) },
    ]);
  } finally {
    f.db.close();
  }
});

it('aborts Run insert and delete whose revision count row is missing', () => {
  const f = populated();
  try {
    expect(() => f.db.exec(`DELETE FROM suite_revision_run_counts WHERE revision_id='${uuid(62)}'`)).toThrow(
      'retained revision run count',
    );
    f.db.exec('DROP TRIGGER revision_run_count_delete');
    f.db.exec(`DELETE FROM suite_revision_run_counts WHERE revision_id='${uuid(62)}'`);
    expect(() => f.run(62, 80, 4)).toThrow('revision run count');
    f.db.exec('PRAGMA foreign_keys=OFF');
    expect(() => f.db.prepare('DELETE FROM runs WHERE id=?').run(uuid(71))).toThrow('revision run count');
    expect(f.db.prepare('SELECT count(*) AS n FROM runs WHERE id=?').get(uuid(71))).toEqual({ n: 1 });
    expect(f.db.prepare('SELECT count(*) AS n FROM runs WHERE id=?').get(uuid(80))).toEqual({ n: 0 });
  } finally {
    f.db.close();
  }
});

function plan(f: ReturnType<typeof suiteListFixture>, sql: string, values: readonly unknown[]): string[] {
  return f.db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...(values as never[]))
    .map((row) => String(row.detail));
}
it('serves every prepared list statement from its covering index without scans or temp sorts', () => {
  const f = populated();
  try {
    for (const order of ['recent_run', 'name'] as const)
      for (const folderId of [undefined, uuid(90)]) {
        const query = { limit: 10, order, ...(folderId ? { folderId } : {}) } as NormalizedSuiteListQuery;
        const index = `suites_latest_${folderId ? 'folder_' : ''}${order === 'name' ? 'name' : 'recent'}`;
        const afters = [null, order === 'name' ? { order, folded: 'b', id: uuid(1) } : { order, requestedAt: time(1), id: uuid(1) }];
        for (const group of storedGroups(query))
          for (const after of afters) {
            const statement = suiteGroupStatement(scope, query, group, after as never);
            const detail = plan(f, statement.sql, statement.values);
            expect(detail.join('\n')).toContain(`SEARCH suites USING INDEX ${index}`);
            expect(detail.some((row) => row.includes('TEMP B-TREE') || row.startsWith('SCAN'))).toBe(false);
          }
      }
    const owner = [scope.organizationId, scope.workspaceId, uuid(90)];
    for (const [sql, values, index] of [
      [folderGroupCountSql, owner, 'suites_latest_folder_recent'],
      [folderNewestSql, [...owner, 'passed'], 'suites_latest_folder_recent'],
      [subfolderCountSql, owner, 'folders_children'],
    ] as const) {
      const detail = plan(f, sql, values);
      expect(detail.join('\n')).toContain(index);
      expect(detail.some((row) => row.includes('TEMP B-TREE') || /^SCAN (suites|folders)\b/.test(row))).toBe(false);
    }
  } finally {
    f.db.close();
  }
});
