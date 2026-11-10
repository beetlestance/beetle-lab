import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sealEngineResult, verifyEngineResultSeal } from '@beetle/contracts';
import type { Artifact } from '@beetle/contracts';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { legacyPayload, oldFacts } from './output-payload-migration-fixtures.js';
import { hash } from './output-payload-fixtures.js';
let root = '';
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'beetle-payload-duplicates-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const artifact: Artifact = { artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'raw', relativePath: 'data.bin',
  bytes: 32, sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' };
function oldSnapshot(path: string) {
  const old = legacyPayload(path); if (!old.snapshot.result) throw new Error('Missing old body');
  const { seal, ...body } = old.snapshot.result;
  const value = sealEngineResult({ ...body, artifacts: [artifact] }, seal.sealedAt, hash);
  if (!value.ok) throw new Error('Invalid old fixture');
  return { ...old, snapshot: { ...old.snapshot, result: value.value } };
}
it.each(['result artifacts', 'artifact bytes'] as const)('migration refuses nested duplicate %s before normalizing an old result body', mode => {
  const path = join(root, 'old.sqlite'); const old = oldSnapshot(path); const canonical = JSON.stringify(old.snapshot);
  const raw = mode === 'result artifacts' ? canonical.replace('"artifacts":', '"artifacts":[],"artifacts":')
    : canonical.replace('"bytes":32', '"bytes":0,"bytes":32');
  expect(raw).not.toBe(canonical);
  const parsed = JSON.parse(raw) as typeof old.snapshot;
  expect(parsed).toEqual(old.snapshot); expect(verifyEngineResultSeal(parsed.result, hash).ok).toBe(true);
  old.db.prepare('UPDATE execution_records SET snapshot_json=?').run(raw);
  const before = oldFacts(old.db); const schema = old.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(); old.db.close();
  let opened: DatabaseSync | undefined; const parse = vi.spyOn(JSON, 'parse');
  try {
    expect(() => { opened = initialize(path); }).toThrow();
    expect(parse).not.toHaveBeenCalledWith(raw);
  } finally { parse.mockRestore(); opened?.close(); }
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(7);
    expect(oldFacts(db)).toEqual(before); expect(db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('migration preserves a normal old result with repeated field names across separate nested objects', () => {
  const path = join(root, 'valid.sqlite'); const old = oldSnapshot(path);
  old.db.prepare('UPDATE execution_records SET snapshot_json=?').run(JSON.stringify(old.snapshot)); old.db.close();
  const db = initialize(path);
  try {
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(8);
    expect(JSON.parse(String(db.prepare('SELECT canonical_json FROM execution_output_payloads').get()?.canonical_json))).toEqual(old.snapshot.result);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
