import { expect, it } from 'vitest';
import type { AckReceipt, EventBatch } from '@beetle/contracts';
import { EVENT_BATCH_BYTES, EVENT_RECORD_BYTES, EVENT_MAX_RETAINED_BYTES, EVENT_MAX_RETAINED_ROWS } from '../../src/domain/events/index.js';
import type { EventCursorState, EventIngestResult } from '../../src/ports/events.js';
import { binding, events, fixture, otherId, receipt, sizedBatch, sizedEvent, state } from './fixture.js';

const badStates: [string, unknown][] = [
  ['extra field', { ...state(), extra: true }],
  ['wrong authority', state({ binding: { ...binding(), journalAuthority: otherId } })],
  ['wrong run', state({ binding: { ...binding(), key: { ...binding().key, runId: binding().key.attempt.attemptId } } })],
  ['wrong digest', state({ binding: { ...binding(), key: { ...binding().key,
    attempt: { ...binding().key.attempt, intentDigest: 'b'.repeat(64) } } } })],
  ['negative durable', state({ durableThrough: -1 })],
  ['unsafe durable', state({ durableThrough: Number.MAX_SAFE_INTEGER + 1 })],
  ['ACK beyond durable', state({ ackConfirmedThrough: 1 })],
  ['row count overflow', state({ eventCount: EVENT_MAX_RETAINED_ROWS + 1 })],
  ['byte count overflow', state({ retainedBytes: EVENT_MAX_RETAINED_BYTES + 1 })],
  ['count does not match contiguous prefix', state({ durableThrough: 2, eventCount: 1 })],
  ['zero bytes for retained rows', state({ durableThrough: 1, retainedBytes: 0 })],
  ['bytes without retained rows', state({ retainedBytes: 1 })],
  ['invalid retained start', state({ retainedStartSeq: 0.5 })],
  ['invalid blockage', state({ blockedReason: 'other' as EventCursorState['blockedReason'] })],
  ['invalid coverage', state({ coverage: 'other' as EventCursorState['coverage'] })],
  ['unblocked partial', state({ coverage: 'partial' })],
];
it.each(badStates)('rejects %s state before network issuance', async (_name, input) => {
  const f = fixture(); f.store.load.mockResolvedValue(input as EventCursorState);
  await expect(f.collect()).rejects.toThrow(); expect(f.attempt).not.toHaveBeenCalled();
});

it('rejects a state accessor without executing it', async () => {
  const f = fixture(); let reads = 0; const value = state();
  Object.defineProperty(value, 'durableThrough', { enumerable: true, get() { reads++; return 0; } });
  f.store.load.mockResolvedValue(value); await expect(f.collect()).rejects.toThrow();
  expect(reads).toBe(0); expect(f.client.events).not.toHaveBeenCalled();
});

const badIngests: [string, EventIngestResult][] = [
  ['insert overflow', { state: state({ durableThrough: 1, eventCount: 1, retainedBytes: 1000 }), inserted: 101, ackThrough: 1 }],
  ['insert beyond batch', { state: state({ durableThrough: 2, eventCount: 2, retainedBytes: 2000 }), inserted: 2, ackThrough: 2 }],
  ['insert beyond durable growth', { state: state(), inserted: 1, ackThrough: 0 }],
  ['insert beyond count growth', { state: state({ durableThrough: 1, eventCount: 0, retainedBytes: 1000 }), inserted: 1, ackThrough: 1 }],
  ['uncharged insert', { state: state({ durableThrough: 1, eventCount: 1, retainedBytes: 0 }), inserted: 1, ackThrough: 1 }],
  ['ACK beyond durable', { state: state({ durableThrough: 1 }), inserted: 0, ackThrough: 2 }],
  ['ACK before batch', { state: state({ durableThrough: 1 }), inserted: 0, ackThrough: 0 }],
  ['uncommitted prefix', { state: state(), inserted: 0, ackThrough: 0 }],
  ['unaccounted concurrent replay', { state: state({ durableThrough: 1, retainedBytes: 1 }), inserted: 0, ackThrough: 1 }],
  ['blocked insert', { state: state({ durableThrough: 1, eventCount: 1, retainedBytes: 1000,
    blockedReason: 'quota_exhausted' }), inserted: 1, ackThrough: 1 }],
  ['wrong binding', { state: state({ binding: { ...binding(), journalAuthority: otherId } }), inserted: 0, ackThrough: 0 }],
];
it.each(badIngests)('rejects %s ingest reply without ACK', async (_name, response) => {
  const f = fixture(); f.store.ingest.mockResolvedValue(response);
  await expect(f.collect()).rejects.toThrow(); expect(f.client.ack).not.toHaveBeenCalled();
});

it('rejects durability or retained-counter regression after ingestion', async () => {
  const f = fixture(); f.held.current = state({ durableThrough: 2, ackConfirmedThrough: 2, eventCount: 2, retainedBytes: 2000 });
  f.client.events.mockResolvedValue({ ok: true, value: events(1, 2) });
  f.store.ingest.mockResolvedValue({ state: state({ durableThrough: 3, ackConfirmedThrough: 1, retainedBytes: 1000,
    eventCount: 1 }), inserted: 0, ackThrough: 3 });
  await expect(f.collect()).rejects.toThrow(); expect(f.client.ack).not.toHaveBeenCalled();
});

it.each([
  ['wrong scope', { ...receipt(), organizationId: otherId }],
  ['wrong generation', { ...receipt(), generation: 2 }],
  ['wrong attempt', { ...receipt(), attemptId: otherId }],
  ['too low', receipt(0)], ['too high', receipt(2)], ['extra field', { ...receipt(), extra: true }],
] as [string, AckReceipt][])('rejects %s positive ACK receipt without confirming it', async (_name, value) => {
  const f = fixture(); f.client.ack.mockResolvedValue({ ok: true, value });
  await expect(f.collect()).rejects.toThrow(); expect(f.store.confirmAck).not.toHaveBeenCalled();
});

it.each(['wrong identity', 'regressed cursor', 'unconfirmed receipt'])(
  'rejects %s confirmation state', async kind => {
    const f = fixture();
    const value = state({ durableThrough: 1, ackConfirmedThrough: 1, retainedBytes: 1000, eventCount: 1 });
    if (kind === 'wrong identity') Object.assign(value, { binding: { ...binding(), journalAuthority: otherId } });
    if (kind === 'regressed cursor') Object.assign(value, { durableThrough: 0, ackConfirmedThrough: 0 });
    if (kind === 'unconfirmed receipt') Object.assign(value, { ackConfirmedThrough: 0 });
    f.store.confirmAck.mockResolvedValue(value); await expect(f.collect()).rejects.toThrow();
  });

it('accepts 100 events and refuses 101 before ingestion', async () => {
  const f = fixture(); f.client.events.mockResolvedValue({ ok: true, value: events(100) });
  await f.collect(); expect(f.client.ack.mock.calls[0]![0].throughSeq).toBe(100);
  const overflow = fixture(); overflow.client.events.mockResolvedValue({ ok: true, value: events(101) });
  await expect(overflow.collect()).rejects.toThrow('invalid_batch'); expect(overflow.store.ingest).not.toHaveBeenCalled();
});

it('accepts the exact producer byte limit and rejects one byte above it before storage', async () => {
  const f = fixture(); f.client.events.mockResolvedValue({ ok: true, value: sizedBatch(EVENT_BATCH_BYTES) });
  await f.collect(); expect(f.client.ack.mock.calls[0]![0].throughSeq).toBe(4);
  const overflow = fixture(); overflow.client.events.mockResolvedValue({ ok: true, value: sizedBatch(EVENT_BATCH_BYTES + 1) });
  await expect(overflow.collect()).rejects.toThrow('invalid_batch'); expect(overflow.store.ingest).not.toHaveBeenCalled();
});

it('delegates the exact record byte limit to the existing canonical owner', async () => {
  const f = fixture(); f.client.events.mockResolvedValue({ ok: true, value: { ...events(), events: [sizedEvent(EVENT_RECORD_BYTES)] } });
  await f.collect(); expect(f.held.current.retainedBytes).toBe(EVENT_RECORD_BYTES + 128);
  const overflow = fixture();
  overflow.client.events.mockResolvedValue({ ok: true, value: { ...events(), events: [sizedEvent(EVENT_RECORD_BYTES + 1)] } });
  await expect(overflow.collect()).rejects.toThrow('invalid_batch'); expect(overflow.store.ingest).not.toHaveBeenCalled();
});

it('bounds oversized array length before materializing any element', async () => {
  const f = fixture(); const batch = events(); const huge: EventBatch['events'] = new Array(1_000_000);
  let reads = 0; Object.defineProperty(huge, '0', { get() { reads++; throw new Error('canary'); } });
  batch.events = huge; f.client.events.mockResolvedValue({ ok: true, value: batch });
  await expect(f.collect()).rejects.toThrow('invalid_batch'); expect(reads).toBe(0);
  expect(f.store.ingest).not.toHaveBeenCalled();
});

it('enforces batch byte, node/depth and descriptor bounds before ingestion', async () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let deep: unknown = null; for (let i = 0; i < 66; i++) deep = { child: deep };
  for (const batch of [{ ...events(), padding: 'x'.repeat(EVENT_BATCH_BYTES) }, deep, cyclic]) {
    const f = fixture(); f.client.events.mockResolvedValue({ ok: true, value: batch as EventBatch });
    await expect(f.collect()).rejects.toThrow('invalid_batch'); expect(f.store.ingest).not.toHaveBeenCalled();
  }
});

it('unattainable safe-integer cursor without retained rows is rejected before GET', async () => {
  const f = fixture(); f.held.current = state({ durableThrough: Number.MAX_SAFE_INTEGER,
    ackConfirmedThrough: Number.MAX_SAFE_INTEGER });
  f.client.events.mockResolvedValue({ ok: true, value: { ...events(), events: events().events,
    nextCursor: Number.MAX_SAFE_INTEGER } });
  await expect(f.collect()).rejects.toThrow();
  expect(f.client.events).not.toHaveBeenCalled(); expect(f.store.ingest).not.toHaveBeenCalled();
});

it('accepts the exact retained row and byte maxima for an empty contiguous turn', async () => {
  const f = fixture(); f.held.current = state({ durableThrough: EVENT_MAX_RETAINED_ROWS,
    ackConfirmedThrough: EVENT_MAX_RETAINED_ROWS, eventCount: EVENT_MAX_RETAINED_ROWS, retainedBytes: EVENT_MAX_RETAINED_BYTES });
  f.client.events.mockResolvedValue({ ok: true, value: events(0, EVENT_MAX_RETAINED_ROWS) });
  await f.collect(); expect(f.store.ingest).toHaveBeenCalledTimes(1); expect(f.client.ack).not.toHaveBeenCalled();
});
