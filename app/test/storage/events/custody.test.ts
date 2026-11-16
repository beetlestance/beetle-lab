import { expect, it } from 'vitest';
import type { EventCursorState, EventIngestResult } from '../../../src/ports/events.js';
import { custody } from '../dispatch-claim-fixtures.js';
import { eventFixture, request, ack } from './fixtures.js';

it('stores a contiguous prefix; equal overlap is free and retains allocation after release', () => {
  const f = eventFixture(); const before = custody(f.db);
  const first = f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 2) }) as EventIngestResult;
  expect(first).toMatchObject({ inserted: 2, ackThrough: 2, state: { eventCount: 2, durableThrough: 2, ackConfirmedThrough: 0 } });
  expect(f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) })).toMatchObject({ inserted: 1, ackThrough: 3 });
  const replay = f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) }) as EventIngestResult;
  expect(replay.inserted).toBe(0); expect(replay.state.retainedBytes).toBe(f.event().chargedBytes * 3);
  expect(custody(f.db)).toEqual(before);
  f.release(f.binding.key);
  expect(f.store.execute({ kind: 'eventScan', query: { limit: 1 } })).toMatchObject({ items: [{ kind: 'ready', binding: f.binding }] });
  expect(f.store.execute({ kind: 'eventLoad', binding: f.binding })).toEqual(replay.state);
});
it('preflights every overlap before appending; first conflict is sticky', () => {
  const f = eventFixture();
  f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 2) });
  const conflicting = request(f.binding, 0, 3); conflicting.batch.events[1]!.observedAt = '2026-01-02T00:00:00Z';
  expect(f.store.execute({ kind: 'eventIngest', request: conflicting })).toMatchObject({ inserted: 0, ackThrough: 2,
    state: { blockedReason: 'replay_conflict', durableThrough: 2, eventCount: 2 } });
  expect(f.db.prepare('SELECT count(*) n FROM run_events').get()?.n).toBe(2);
  expect(f.store.execute({ kind: 'eventProblem', request: { binding: f.binding, after: 0, kind: 'missing_receipt' } }))
    .toMatchObject({ blockedReason: 'replay_conflict' });
  expect(f.store.execute({ kind: 'eventIngest', request: request(f.binding, 2, 1) })).toMatchObject({ inserted: 0, ackThrough: 2 });
});
it('allows exact quota and duplicate replay without charging a second copy; overflow appends nothing', () => {
  const sample = eventFixture(); const charge = sample.event().chargedBytes;
  const f = eventFixture(charge * 2); const before = custody(f.db);
  expect(f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 2) })).toMatchObject({ inserted: 2 });
  expect(f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 2) })).toMatchObject({ inserted: 0 });
  expect(f.store.execute({ kind: 'eventIngest', request: request(f.binding, 1, 2) })).toMatchObject({ inserted: 0,
    state: { blockedReason: 'quota_exhausted', eventCount: 2, retainedBytes: charge * 2 } });
  expect(custody(f.db)).toEqual(before);
  const zero = eventFixture(charge - 1);
  expect(zero.store.execute({ kind: 'eventIngest', request: request(zero.binding, 0, 2) })).toMatchObject({ inserted: 0,
    state: { durableThrough: 0, retainedBytes: 0 } });
});
it('confirms only a matched remotely acknowledged local prefix, including after blockage', () => {
  const f = eventFixture(); f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) });
  const confirm = (throughSeq: number, receipt: unknown) => f.store.execute({ kind: 'eventConfirmAck', request: { binding: f.binding, throughSeq, receipt } });
  expect(() => confirm(2, ack(f.binding, 4))).toThrow();
  expect(() => confirm(3, ack(f.binding, 2))).toThrow();
  expect(() => confirm(2, { ...ack(f.binding, 3), attemptId: f.binding.key.runId })).toThrow();
  f.store.execute({ kind: 'eventProblem', request: { binding: f.binding, after: 3, kind: 'missing_receipt' } });
  expect(confirm(2, ack(f.binding, 3))).toMatchObject({ ackConfirmedThrough: 3, blockedReason: 'missing_receipt' });
  expect(confirm(1, ack(f.binding, 1))).toMatchObject({ ackConfirmedThrough: 3 });
});
it('ignores covered stale expiry and permanently retains a gap or prior first problem', () => {
  const f = eventFixture(); f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) });
  const load = () => f.store.execute({ kind: 'eventLoad', binding: f.binding }) as EventCursorState;
  const expiry = (retainedStartSeq: number) => f.store.execute({ kind: 'eventProblem', request: {
    binding: f.binding, after: 0, kind: 'cursor_expired', retainedStartSeq } });
  const clean = load(); expect(expiry(4)).toEqual(clean);
  expect(() => expiry(1)).toThrow();
  expect(expiry(5)).toMatchObject({ coverage: 'partial', blockedReason: 'cursor_expired', retainedStartSeq: 5 });
  const partial = load(); expect(expiry(4)).toEqual(partial); expect(expiry(6)).toEqual(partial);
  const other = eventFixture(); other.store.execute({ kind: 'eventIngest', request: request(other.binding, 0, 3) });
  const blocked = other.store.execute({ kind: 'eventProblem', request: { binding: other.binding, after: 1, kind: 'missing_receipt' } });
  expect(other.store.execute({ kind: 'eventProblem', request: { binding: other.binding, after: 0,
    kind: 'cursor_expired', retainedStartSeq: 4 } })).toEqual(blocked);
});
it('rejects wrong scope, UUID, digest, generation, gaps and leaps without local authority', () => {
  const f = eventFixture();
  for (const field of ['organizationId', 'workspaceId', 'attemptId', 'intentDigest', 'generation'] as const) {
    const binding = structuredClone(f.binding);
    Reflect.set(binding.key.attempt, field, field === 'generation' ? 2 : field === 'intentDigest' ? 'f'.repeat(64) : '00000000-0000-4000-8000-000000000999');
    expect(() => f.store.execute({ kind: 'eventLoad', binding })).toThrow();
  }
  expect(() => f.store.execute({ kind: 'eventLoad', binding: { ...f.binding, journalAuthority: '44444444-4444-4444-8444-444444444444' } })).toThrow();
  expect(() => f.store.execute({ kind: 'eventLoad', binding: { ...f.binding, key: { ...f.binding.key, runId: f.binding.key.attempt.attemptId } } })).toThrow();
  const gap = request(f.binding); gap.batch.events[0]!.seq = 2;
  expect(() => f.store.execute({ kind: 'eventIngest', request: gap })).toThrow();
  expect(() => f.store.execute({ kind: 'eventIngest', request: request(f.binding, 1, 1) })).toThrow();
  expect(f.db.prepare('SELECT count(*) n FROM run_events').get()?.n).toBe(0);
});
