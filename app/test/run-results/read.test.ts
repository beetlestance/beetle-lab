import { expect, it } from 'vitest';
import { RunResults } from '../../src/adapters/outbound/sqlite/run-results/index.js';
import { payloadFixture } from '../storage/output-payload-fixtures.js';
import { fixture, guardsOff, keyFor, scope, uuid } from './fixture.js';

it('reads queued, unacknowledged and acknowledged pending as null, then exactly the sole adopted result without effects', () => {
  const f = fixture(); const reader = new RunResults(f.db, f.reads);
  const queued = f.add(74);
  expect(reader.get(keyFor(queued.runId))).toMatchObject({ activeAttemptId: queued.attempt.attemptId, result: null });
  const key = keyFor(f.key.runId);
  expect(reader.get(key)).toEqual({ id: key.id, scope, activeAttemptId: f.key.attempt.attemptId, result: null });
  f.adopt(); const before = f.facts();
  const source = f.db.prepare('SELECT * FROM execution_output_sources').all();
  const result = reader.get(key);
  expect(result.result).toEqual(f.envelope.manifest.result);
  expect(f.facts()).toEqual(before);
  expect(f.db.prepare('SELECT * FROM execution_output_sources').all()).toEqual(source);
  expect(f.carrier()).toHaveLength(1);
  expect(Object.keys(result)).toEqual(['id', 'scope', 'activeAttemptId', 'result']);
  const unacknowledged = payloadFixture(10000, false);
  expect(new RunResults(unacknowledged.db, unacknowledged.reads).get(keyFor(unacknowledged.key.runId)).result).toBeNull();
});

it('fences namespace/run/active-attempt ownership', () => {
  const f = fixture(); f.adopt(); const reader = new RunResults(f.db, f.reads);
  for (const key of [{ ...keyFor(f.key.runId), scope: { ...scope, organizationId: uuid(21) } },
    { ...keyFor(f.key.runId), scope: { ...scope, workspaceId: uuid(22) } }, keyFor(uuid(999))]) {
    expect(() => reader.get(key)).toThrow(expect.objectContaining({ code: 'not_found' }));
  }
  const next = f.add(74);
  // Model damaged active-attempt ownership independently of the production FK guards.
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE runs SET active_attempt_id=? WHERE id=?').run(next.attempt.attemptId, f.key.runId);
  expect(() => reader.get(keyFor(f.key.runId))).toThrow(expect.objectContaining({ code: 'unavailable' }));
});

it.each(['missing carrier', 'manifest seal', 'source metadata', 'original pin', 'retained owner', 'run engine'] as const)(
'rejects corrupt or contradictory %s instead of a fabricated pending/result reply', mode => {
  const f = fixture(); f.adopt();
  switch (mode) {
    case 'missing carrier':
      guardsOff(f.db, 'execution_output_payloads'); f.db.exec('DELETE FROM execution_output_payloads'); break;
    case 'manifest seal': {
      guardsOff(f.db, 'execution_output_payloads');
      const manifest = f.envelope.manifest;
      f.db.prepare('UPDATE execution_output_payloads SET canonical_json=?').run(JSON.stringify({ ...manifest,
        result: { ...manifest.result, seal: { ...manifest.result.seal, sha256: 'f'.repeat(64) } } })); break;
    }
    case 'source metadata':
      guardsOff(f.db, 'execution_output_sources');
      f.db.prepare('UPDATE execution_output_sources SET manifest_digest=?').run('f'.repeat(64)); break;
    case 'original pin':
      guardsOff(f.db, 'attempts');
      f.db.exec("UPDATE attempts SET offer_json=json_set(offer_json,'$.engine.imageDigest','sha256:" + 'f'.repeat(64) + "')"); break;
    case 'retained owner':
      guardsOff(f.db, 'execution_records'); f.db.exec('PRAGMA foreign_keys=OFF');
      f.db.prepare('UPDATE execution_records SET run_id=?').run(uuid(999)); break;
    case 'run engine':
      guardsOff(f.db, 'runs');
      f.db.exec("UPDATE runs SET snapshot_json=json_set(snapshot_json,'$.engine.id','other')"); break;
  }
  expect(() => new RunResults(f.db, f.reads).get(keyFor(f.key.runId))).toThrow();
});
