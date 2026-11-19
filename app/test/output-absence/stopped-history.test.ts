import { expect, it } from 'vitest';
import { absenceFixture } from './fixture.js';
import { observed } from './stopped-history-fixture.js';

type Fixture = ReturnType<typeof absenceFixture>;
const observations = (f: Fixture) => f.db.prepare('SELECT * FROM execution_stopped_history').all();

function prepare(f: Fixture) {
  f.adopt();
  f.release({ exitEvidence: { exitCode: 137, oomKilled: true, observedAt: '2026-01-01T00:01:00Z' } });
  f.ingest();
}
const finalize = (f: Fixture, stoppedHistory: 'fetch' | ReturnType<typeof observed>) =>
  f.absences.execute({ kind: 'absenceFinalize', request: { ...f.command(), stoppedHistory } });

it('fetches only after exact ACK and settles recovered bytes with one immutable receipt', () => {
  const f = absenceFixture();
  prepare(f);
  expect(finalize(f, 'fetch')).toEqual({ kind: 'pending', reason: 'events' });
  f.confirm();
  expect(finalize(f, 'fetch')).toEqual({ kind: 'pending', reason: 'history' });
  const sample = observed(f);
  const charged = f.usage();
  const events = Number(f.cursor().retained_bytes);
  const reply = finalize(f, sample);
  expect(reply).toMatchObject({
    kind: 'finalized',
    receipt: {
      retainedPayloadBytes: events + sample.bytes,
      refundedBytes: 10000 - events - sample.bytes,
      reason: 'memory_limit',
    },
  });
  expect(f.usage()).toBe(charged - (10000 - events - sample.bytes));
  expect(observations(f)).toEqual([
    expect.objectContaining({ canonical_json: sample.json, digest: sample.digest, bytes: sample.bytes }),
  ]);
  expect(finalize(f, 'fetch')).toEqual(reply);
  expect(finalize(f, sample)).toEqual(reply);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('settles ordinary partial output when the verified observation would exceed the remaining budget', () => {
  const seed = absenceFixture();
  prepare(seed);
  const bytes = Number(seed.cursor().retained_bytes);
  const f = absenceFixture({ maximum: bytes + 1 });
  prepare(f);
  f.confirm();
  expect(finalize(f, observed(f))).toMatchObject({
    kind: 'finalized',
    receipt: { retainedPayloadBytes: bytes, refundedBytes: 1 },
  });
  expect(observations(f)).toEqual([]);
});

it('rejects invalid bytes and later raw inserts without changing the receipt', () => {
  const f = absenceFixture();
  prepare(f);
  f.confirm();
  const valid = observed(f);
  expect(() => finalize(f, { ...valid, digest: 'f'.repeat(64) })).toThrow();
  expect(observations(f)).toEqual([]);
  const receipt = f.finalize();
  expect(() =>
    f.db
      .prepare(
        'INSERT INTO execution_stopped_history(attempt_id,proof_digest,canonical_json,digest,bytes) VALUES(?,?,?,?,?)',
      )
      .run(f.binding.key.attempt.attemptId, f.command().proofDigest, valid.json, valid.digest, valid.bytes),
  ).toThrow(/stopped history requires/);
  expect(f.finalize()).toEqual(receipt);
});
