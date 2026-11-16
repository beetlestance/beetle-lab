import { expect, it, vi } from 'vitest';
import type { StatementSync } from 'node:sqlite';
import { payloadFixture, json } from './output-payload-fixtures.js';

it.each(['embedded', 'missing', 'extra', 'oversized'] as const)('native header rejects %s body/boundary and preserves rows/counters', mode => {
  const f = payloadFixture(); const old = JSON.parse(String(f.db.prepare('SELECT snapshot_json FROM execution_records').get()?.snapshot_json)) as object;
  const before = f.facts();
  const issue = () => {
    if (mode === 'missing') f.db.exec('UPDATE execution_records SET result_observed=1');
    else f.db.prepare('UPDATE execution_records SET snapshot_json=?').run(JSON.stringify({ ...old,
      ...(mode === 'embedded' ? { result: f.value } : mode === 'extra' ? { extra: 1 } : { extra: 'x'.repeat(2049) }) }));
  };
  expect(issue).toThrow(); expect(f.facts()).toEqual(before);
});
it.each(['wrong identity', 'wrong generation', 'oversized', 'delete', 'replace', 'mutate', 'clear observed'] as const)('native result rejects %s with exact unchanged state', mode => {
  const f = payloadFixture();
  if (['delete', 'replace', 'mutate', 'clear observed'].includes(mode)) f.observe({ lastSeq: 2, result: f.value });
  const before = f.facts(); const issue = () => {
    if (mode === 'delete') f.db.exec('DELETE FROM execution_output_payloads');
    else if (mode === 'mutate') f.db.prepare('UPDATE execution_output_payloads SET canonical_json=?').run(json({ ...f.value, completeness: 'partial' }));
    else if (mode === 'clear observed') f.db.exec('UPDATE execution_records SET result_observed=0');
    else {
      const value = mode === 'wrong identity' ? { ...f.value, attemptId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }
        : mode === 'wrong generation' ? { ...f.value, generation: 1.5 } : mode === 'oversized' ? { ...f.value, extra: 'x'.repeat(65536) } : f.value;
      f.db.prepare(`${mode === 'replace' ? 'INSERT OR REPLACE' : 'INSERT'} INTO execution_output_payloads VALUES(?,'result',?)`)
        .run(f.key.attempt.attemptId, JSON.stringify(value));
    }
  };
  expect(issue).toThrow(); expect(f.facts()).toEqual(before); expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['string', 'fraction', 'unsafe', 'sum debt'] as const)('native manifest rejects %s artifact bytes without recording a carrier', mode => {
  const f = payloadFixture(); const value = structuredClone(f.manifest());
  const bytes = mode === 'string' ? '32' : mode === 'fraction' ? 0.5 : mode === 'unsafe' ? Number.MAX_SAFE_INTEGER + 1 : Number.MAX_SAFE_INTEGER;
  Reflect.set(value.result, 'artifacts', [{ artifactId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'raw', relativePath: 'file', sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z', bytes }]);
  const before = f.facts();
  expect(() => f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, JSON.stringify(value))).toThrow();
  expect(f.facts()).toEqual(before);
});
it('native manifest cannot precede acknowledgement or replace a different observed body', () => {
  const f = payloadFixture(10000, false); const before = f.facts(); expect(() => f.putManifest()).toThrow(); expect(f.facts()).toEqual(before);
  f.observe({ lastSeq: 2, result: f.value }); const old = f.facts(); const value = structuredClone(f.manifest()); Reflect.set(value.result, 'completeness', 'partial');
  expect(() => f.db.prepare("UPDATE execution_output_payloads SET kind='manifest',canonical_json=?").run(JSON.stringify(value))).toThrow(); expect(f.facts()).toEqual(old);
});
it('CASE-bounds a corrupted carrier scalar before reading returned text', () => {
  const f = payloadFixture(); f.observe({ lastSeq: 2, result: f.value }); const prepare = f.db.prepare.bind(f.db);
  const text = vi.fn(() => { throw new Error('unbounded body materialization'); });
  const spy = vi.spyOn(f.db, 'prepare').mockImplementation(sql => {
    if (!sql.includes('FROM execution_output_payloads WHERE')) return prepare(sql);
    return { get: () => Object.defineProperty({ kind: 'result', bytes: 65537 }, 'canonical_json', { get: text }) } as unknown as StatementSync;
  });
  try { expect(() => f.observe({ lastSeq: 3, result: f.value })).toThrow(); expect(text).not.toHaveBeenCalled(); }
  finally { spy.mockRestore(); }
});
it.each(['version', 'generation'] as const)('native manifest refuses boolean %s masquerading as integer1', field => {
  const f = payloadFixture(); const value = structuredClone(f.manifest());
  Reflect.set(field === 'version' ? value : value.binding, field, true); const before = f.facts();
  expect(() => f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, JSON.stringify(value))).toThrow();
  expect(f.facts()).toEqual(before);
});
