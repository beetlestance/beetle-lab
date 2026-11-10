import { expect, it } from 'vitest';
import { payloadFixture, json } from './output-payload-fixtures.js';

it('splits a first-ACK result and reconstructs exact same-sequence and stale replies through the original merge', () => {
  const f = payloadFixture(10000, false); const beforeUsage = f.db.prepare('SELECT * FROM installation_storage_usage').all();
  const first = f.observe({ lastSeq: 5, state: 'exited', result: f.value, admission: { state: 'released', disposition: 'settled' } });
  const row = f.db.prepare('SELECT snapshot_json,result_observed,execution_charged FROM execution_records').get()!;
  expect(JSON.parse(String(row.snapshot_json))).not.toHaveProperty('result'); expect(row).toMatchObject({ result_observed: 1, execution_charged: 0 });
  expect(f.carrier()).toEqual([{ attempt_id: f.key.attempt.attemptId, kind: 'result', canonical_json: json(f.value) }]);
  expect(f.observe({ lastSeq: 5, state: 'exited', result: f.value, admission: { state: 'released', disposition: 'settled' } }).snapshot).toEqual(first.snapshot);
  expect(f.observe({ lastSeq: 3 }).snapshot).toEqual(first.snapshot);
  const before = f.facts();
  expect(() => f.observe({ lastSeq: 6, state: 'exited', result: { ...f.value, seal: { ...f.value.seal, sha256: 'f'.repeat(64) } } })).toThrow();
  expect(f.facts()).toEqual(before); expect(f.db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(beforeUsage);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it('manifest presence does not manufacture an observed result; a late matching result uses its one body', () => {
  const f = payloadFixture(); const manifest = f.putManifest();
  expect(f.observe({ lastSeq: 2 }).snapshot).not.toHaveProperty('result');
  expect(f.db.prepare('SELECT result_observed FROM execution_records').get()?.result_observed).toBe(0);
  expect(f.observe({ lastSeq: 3, result: f.value }).snapshot.result).toEqual(f.value);
  expect(f.carrier()).toEqual([{ attempt_id: f.key.attempt.attemptId, kind: 'manifest', canonical_json: manifest }]);
  const before = f.facts();
  expect(() => f.observe({ lastSeq: 4, result: { ...f.value, seal: { ...f.value.seal, sha256: 'f'.repeat(64) } } })).toThrow(); expect(f.facts()).toEqual(before);
});
it('replaces the exact result in one native row, preserving its observed marker and immutable manifest replay', () => {
  const f = payloadFixture(); f.observe({ lastSeq: 2, result: f.value }); const text = f.putManifest();
  expect(f.carrier()).toHaveLength(1); expect(f.observe({ lastSeq: 3, result: f.value }).snapshot.result).toEqual(f.value);
  expect(() => f.db.prepare('UPDATE execution_output_payloads SET canonical_json=?').run(text)).not.toThrow();
  const before = f.facts(); expect(() => f.db.prepare("UPDATE execution_output_payloads SET kind='result',canonical_json=?").run(json(f.value))).toThrow();
  expect(f.facts()).toEqual(before);
});
it('persists and releases a result-free first ACK with P=1 without spending payload bytes', () => {
  const f = payloadFixture(1, false); const before = f.db.prepare('SELECT * FROM installation_storage_usage').all();
  expect(f.observe({ state: 'exited', admission: { state: 'released', disposition: 'never_started' } })).toMatchObject({ executionCharged: false });
  expect(f.carrier()).toEqual([]); expect(f.db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(before);
  expect(f.db.prepare('SELECT acknowledged_generation,result_observed FROM execution_records').get()).toEqual({ acknowledged_generation: 1, result_observed: 0 });
});
it('late SQL failure rolls back a new body together with original ACK, release, rows and charge', () => {
  const f = payloadFixture(10000, false); const before = f.facts();
  f.db.exec("CREATE TRIGGER synthetic_late_failure BEFORE DELETE ON dispatch_outbox BEGIN SELECT RAISE(ABORT,'late failure'); END;");
  expect(() => f.observe({ result: f.value, admission: { state: 'released', disposition: 'settled' } })).toThrow();
  expect(f.facts()).toEqual(before);
});
