import { expect, it } from 'vitest';
import { RunExecutions, captureExecutionReply } from '../../src/adapters/outbound/sqlite/execution-binding/index.js';
import { payloadFixture } from '../storage/output-payload-fixtures.js';
import { fixture, guardsOff, keyFor, uuid } from '../run-results/fixture.js';
it('reads exact retained execution authority without loading config or changing metadata', () => {
  const f = fixture(); const reader = new RunExecutions(f.db, f.reads); const before = f.facts();
  const value = reader.get(keyFor(f.key.runId));
  expect(value.binding).toEqual(f.binding); expect(value.run.activeAttemptId).toBe(f.key.attempt.attemptId);
  expect(value.run).not.toHaveProperty('config'); expect(f.facts()).toEqual(before);
  const queued = f.add(74); expect(reader.get(keyFor(queued.runId)).binding).toBeNull();
});
it('does not substitute current authority for an unacknowledged original', () => {
  const f = payloadFixture(10000, false);
  expect(new RunExecutions(f.db, f.reads).get(keyFor(f.key.runId)).binding).toBeNull();
});
it.each(['run', 'intent', 'authority', 'generation', 'scope', 'missing retained owner'] as const)('rejects unsafe retained authority: %s', cause => {
  const f = fixture(); guardsOff(f.db, 'execution_records'); f.db.exec('PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON');
  if (cause === 'run') f.db.prepare('UPDATE execution_records SET run_id=?').run(uuid(999));
  if (cause === 'intent') f.db.prepare('UPDATE execution_records SET intent_digest=?').run('f'.repeat(64));
  if (cause === 'authority') f.db.prepare('UPDATE execution_records SET journal_authority=?').run('not-authority');
  if (cause === 'generation') f.db.exec('UPDATE execution_records SET acknowledged_generation=2');
  if (cause === 'scope') f.db.prepare('UPDATE execution_records SET organization_id=?').run(uuid(999));
  if (cause === 'missing retained owner') {
    f.db.exec('DELETE FROM execution_records');
    expect(new RunExecutions(f.db, f.reads).get(keyFor(f.key.runId)).binding).toBeNull(); return;
  }
  expect(() => new RunExecutions(f.db, f.reads).get(keyFor(f.key.runId))).toThrow();
});
it('bounds and binds parent replies independently of worker claims', () => {
  const f = fixture(); const key = keyFor(f.key.runId); const value = new RunExecutions(f.db, f.reads).get(key);
  expect(() => captureExecutionReply(key, {...value, run: {...value.run, id: uuid(999)}})).toThrow();
  expect(() => captureExecutionReply(key, {...value, binding: {...f.binding, key: {...f.key, runId: uuid(999)}}})).toThrow();
  expect(() => captureExecutionReply(key, {...value, padding: 'x'.repeat(20000)})).toThrow();
});
