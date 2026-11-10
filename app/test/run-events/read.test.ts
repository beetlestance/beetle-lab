import { expect, it } from 'vitest';
import { captureRunEventCursor, encodeRunEventCursor } from '@beetle/contracts/api';
import { fixture, request, guardsOff, scope, uuid } from './fixture.js';
const raw = (position: unknown) => btoa(JSON.stringify(position)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
import { captureRunEventsOperation, captureRunEventsReply } from '../../src/adapters/outbound/sqlite/run-events/index.js';

it('reads scoped durable prefixes/resume/caught-up/pending without ACK, accounting or run mutations', () => {
  const f = fixture(); const queued = f.add(74);
  const before = f.facts();
  const pending = f.reader.get(f.query);
  expect(pending).toMatchObject({ coverage: 'pending', durableThrough: 0, items: [], nextCursor: null });
  expect(f.reader.get({ ...f.query, id: queued.runId })).toMatchObject({ coverage: 'pending', items: [], durableThrough: 0 });
  expect(f.facts()).toEqual(before);
  f.events.ingest(request(f.binding, 0, 5));
  const facts = f.facts();
  const first = f.reader.get({ ...f.query, limit: 2 });
  expect(first.items.map(e => e.seq)).toEqual([1, 2]); expect(first.nextCursor).toBe(first.resumeCursor);
  const second = f.reader.get({ ...f.query, cursor: first.nextCursor! });
  expect(second.items.map(e => e.seq)).toEqual([3, 4, 5]); expect(second.nextCursor).toBeNull();
  expect(f.reader.get({ ...f.query, cursor: second.resumeCursor })).toMatchObject({ items: [], afterSeq: 5, durableThrough: 5 });
  f.events.recordProblem({ binding: f.binding, after: 5, kind: 'cursor_expired', retainedStartSeq: 10 });
  expect(f.reader.get(f.query)).toMatchObject({ coverage: 'partial', blockedReason: 'cursor_expired', retainedStartSeq: 10 });
  expect(f.facts().filter((_, i) => i !== 2)).toEqual(facts.filter((_, i) => i !== 2));
});

it('resolves scope first and rejects foreign, stale, future, unsafe, negative and noncanonical positions', () => {
  const f = fixture(); f.events.ingest(request(f.binding));
  const page = f.reader.get(f.query); const p = captureRunEventCursor(page.resumeCursor);
  for (const cursor of ['!', 'x'.repeat(513), page.resumeCursor + '=',
    encodeRunEventCursor({ ...p, runId: uuid(999) }), encodeRunEventCursor({ ...p, attemptId: uuid(999) }),
    encodeRunEventCursor({ ...p, workspaceId: uuid(999) }), encodeRunEventCursor({ ...p, afterSeq: 2 }),
    raw({ ...p, afterSeq: -1 }), raw({ ...p, afterSeq: Number.MAX_SAFE_INTEGER + 1 })]) {
    expect(() => f.reader.get({ ...f.query, cursor })).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  }
  for (const query of [{ ...f.query, id: uuid(999) }, { ...f.query, scope: { ...scope, organizationId: uuid(999) } },
    { ...f.query, scope: { ...scope, workspaceId: uuid(999) } }]) {
    expect(() => f.reader.get({ ...query, cursor: 'AA' })).toThrow(expect.objectContaining({ code: 'not_found' }));
  }
  for (const limit of [0, 101, 1.5]) expect(() => f.reader.get({ ...f.query, limit })).toThrow();
});

it.each(['json', 'identity', 'sequence', 'generation', 'owner', 'charge'] as const)('fails closed on stored %s corruption', mode => {
  const f = fixture(); f.events.ingest(request(f.binding)); guardsOff(f.db, 'run_events');
  if (mode === 'owner') {
    guardsOff(f.db, 'event_cursors'); f.db.exec('PRAGMA foreign_keys=OFF');
    f.db.prepare('UPDATE event_cursors SET run_id=?').run(uuid(999));
  } else if (mode === 'charge') {
    f.db.exec('PRAGMA ignore_check_constraints=ON'); f.db.exec('UPDATE run_events SET cumulative_bytes=cumulative_bytes+1');
  } else {
    const event = request(f.binding).batch!.events[0]!;
    const bad = mode === 'json' ? {} : { ...event, ...(mode === 'identity' ? { attemptId: uuid(999) }
      : mode === 'sequence' ? { seq: 2 } : { generation: 2 }) };
    const text = JSON.stringify(bad);
    f.db.prepare('UPDATE run_events SET canonical_json=?,charged_bytes=?,cumulative_bytes=?').run(text, Buffer.byteLength(text) + 128, Buffer.byteLength(text) + 128);
  }
  expect(() => f.reader.get(f.query)).toThrow(expect.objectContaining({ code: 'unavailable' }));
});

it('captures closed descriptor-safe RPC inputs and semantically checks replies', () => {
  const f = fixture(); const input = { kind: 'getRunEvents', query: f.query };
  expect(captureRunEventsOperation(input)).toEqual(input);
  for (const bad of [{ ...input, extra: true }, { ...input, query: { ...f.query, extra: true } },
    Object.defineProperty({}, 'kind', { get: () => { throw new Error('invoked'); } })]) {
    expect(() => captureRunEventsOperation(bad)).toThrow();
  }
  const page = f.reader.get(f.query);
  expect(captureRunEventsReply(f.query, page)).toEqual(page);
  expect(() => captureRunEventsReply(f.query, { ...page, activeAttemptId: uuid(999) })).toThrow();
});

it('caps a requested page at 100 contiguous events', () => {
  const f = fixture(); f.events.ingest(request(f.binding, 0, 100)); f.events.ingest(request(f.binding, 100, 1));
  const page = f.reader.get(f.query);
  expect(page.items).toHaveLength(100); expect(page.nextCursor).toBe(page.resumeCursor);
  expect(f.reader.get({ ...f.query, cursor: page.resumeCursor }).items.map(e => e.seq)).toEqual([101]);
});
