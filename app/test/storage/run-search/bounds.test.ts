import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { scope, seed, storageFixture, uuid, createFolder, requestId } from '../fixture.js';
import { append, createSuite, suiteCommand } from '../suites-fixture.js';
import { runCommand, runOptions } from '../runs-fixture.js';
import { registerSearchFold } from '../../../src/adapters/outbound/sqlite/run-search-fold.js';
import type { Metadata } from '../../../src/adapters/outbound/sqlite/index.js';
const fixture = storageFixture();
async function prepared(metadata: Metadata): Promise<void> {
  for (let step = 0; step < 40; step++) {
    try { await metadata.runs.listRuns({ scope, limit: 1, name: 'no such name' }); return; }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'search_indexing') throw error; }
  }
  throw new Error('Backfill exceeded fixture document budget');
}
it('rejects oversized UUID prefixes before filters/cursors but pages the same many-run suite by name', async () => {
  const metadata = await fixture.open(undefined, runOptions(512)); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata, 50, scope, 'Many histories'));
  for (let id = 500; id < 758; id++) await metadata.runs.execute(runCommand(revision.id, id));
  const first = await metadata.runs.listRuns({ scope, limit: 1, name: 'histories' });
  expect(first.items.map(row => row.id)).toEqual([uuid(757)]);
  expect((await metadata.runs.listRuns({ scope, limit: 1, name: 'histories', cursor: first.nextCursor! })).items.map(row => row.id)).toEqual([uuid(756)]);
  for (const extra of [{}, { state: 'finished' as const }, { outcome: 'passed' as const }]) {
    await expect(metadata.runs.listRuns({ scope, limit: 1, runIdPrefix: '00000000', ...extra })).rejects.toMatchObject({ code: 'search_too_broad' });
  }
  const exact = await metadata.runs.listRuns({ scope, limit: 1, runIdPrefix: uuid(500) });
  expect(exact.items.map(row => row.id)).toEqual([uuid(500)]); expect(exact.nextCursor).toBeNull();
});
it('reports broad postings and folder/suite expansion instead of truncating; rare terms remain usable', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata);
  const suiteParent = await createFolder(metadata, 401, uuid(3), scope, 'Suite family');
  const parent = await createFolder(metadata, 400, uuid(3), scope, 'Expanded family');
  for (let n = 50; n < 307; n++) {
    const suite = await createSuite(metadata, n, scope, n === 306 ? 'Common match unicorn' : 'Common match ' + n);
    await metadata.suites.execute(suiteCommand({ kind: 'patchSuite', id: suite.id,
      request: { scope, requestId: requestId(), expectedVersion: 1, folderId: suiteParent.id } }));
  }
  await prepared(metadata);
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'common' })).rejects.toMatchObject({ code: 'search_too_broad' });
  expect((await metadata.runs.listRuns({ scope, limit: 1, name: 'common match unicorn' })).items).toEqual([]);
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'suite family', state: 'finished' })).rejects.toMatchObject({ code: 'search_too_broad' });
  for (let n = 600; n < 857; n++) await createFolder(metadata, n, parent.id, scope, 'Leaf ' + n);
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'expanded family' })).rejects.toMatchObject({ code: 'search_too_broad' });
  // A workspace name matches all runs directly and does not enumerate suites.
  await expect(metadata.runs.listRuns({ scope, limit: 1, name: 'project', state: 'finished' })).resolves.toMatchObject({ items: [] });
});
it('indexes name edits atomically with bounded postings and removes deleted owners', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, runOptions()); await seed(metadata);
  await createSuite(metadata, 50, scope, 'Repeated repeated repeated'); await fixture.close(metadata);
  const db = new DatabaseSync(path); registerSearchFold(db);
  const before = db.prepare("SELECT COUNT(*) AS n FROM history_name_grams WHERE entity_id=?").get(uuid(50))?.n;
  expect(Number(before)).toBeLessThan(25);
  expect(() => db.prepare('UPDATE suites SET folded_name=? WHERE id=?').run('x'.repeat(4097), uuid(50))).toThrow();
  expect(db.prepare('SELECT folded_name FROM suites WHERE id=?').get(uuid(50))?.folded_name).toBe('repeated repeated repeated');
  expect(db.prepare('SELECT COUNT(*) AS n FROM history_name_grams WHERE entity_id=?').get(uuid(50))?.n).toBe(before);
  db.prepare('DELETE FROM suites WHERE id=?').run(uuid(50));
  expect(db.prepare('SELECT COUNT(*) AS n FROM history_name_grams WHERE entity_id=?').get(uuid(50))?.n).toBe(0);
  db.close();
});
