import { expect, it } from 'vitest';
import type { EventCursorState, EventIngestResult } from '../../../src/ports/events.js';
import { captureEventReply } from '../../../src/adapters/outbound/sqlite/event-custody/index.js';
import { eventFixture, request } from './fixtures.js';
it('requires current durability to cover after even for empty or blocked replies', () => {
  const f = eventFixture();
  const clean = f.store.execute({ kind: 'eventLoad', binding: f.binding }) as EventCursorState;
  const blocked = f.store.execute({ kind: 'eventProblem', request: { binding: f.binding, after: 0, kind: 'missing_receipt' } });
  for (const state of [clean, blocked]) {
    expect(() => captureEventReply({ kind: 'eventIngest', request: request(f.binding, 1, 0) },
      { state, inserted: 0, ackThrough: 0 })).toThrow();
  }
});
it('rejects a clean reply that retains only part of the issued batch', () => {
  const f = eventFixture();
  const result = f.store.execute({ kind: 'eventIngest', request: request(f.binding) });
  expect(() => captureEventReply({ kind: 'eventIngest', request: request(f.binding, 0, 2) }, result)).toThrow();
});
it('allows higher durable prefixes, equal replay and lower safe ACK authorization', () => {
  const f = eventFixture();
  const result = f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) }) as EventIngestResult;
  const issued = request(f.binding, 1, 1);
  for (const inserted of [0, 1]) {
    const reply = { ...result, inserted, ackThrough: 2 };
    expect(captureEventReply({ kind: 'eventIngest', request: issued }, reply)).toEqual(reply);
  }
});
it('allows blocked partial progress only with zero inserted rows under the issued after cursor', () => {
  const f = eventFixture(); f.store.execute({ kind: 'eventIngest', request: request(f.binding) });
  const state = f.store.execute({ kind: 'eventProblem', request: { binding: f.binding, after: 1, kind: 'quota_exhausted' } });
  const operation = { kind: 'eventIngest' as const, request: request(f.binding, 1, 2) };
  expect(captureEventReply(operation, { state, inserted: 0, ackThrough: 0 })).toEqual({ state, inserted: 0, ackThrough: 0 });
  expect(() => captureEventReply(operation, { state, inserted: 1, ackThrough: 0 })).toThrow();
});

it.each([0, 1])('rejects unblocked ACK %i below the issued batch endpoint despite higher durable state', ackThrough => {
  const f = eventFixture();
  const result = f.store.execute({ kind: 'eventIngest', request: request(f.binding, 0, 3) }) as EventIngestResult;
  expect(() => captureEventReply({ kind: 'eventIngest', request: request(f.binding, 1, 1) },
    { ...result, inserted: 0, ackThrough })).toThrow();
});
