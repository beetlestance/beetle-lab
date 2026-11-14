import { expect, it, vi } from 'vitest';
import { validate } from '@beetle/contracts';
import { captureEventOperation, captureEventReply } from '../../../src/adapters/outbound/sqlite/event-custody/index.js';
import { checkedOperation, operationMessageLimit } from '../../../src/adapters/outbound/sqlite/input.js';
import { ack, eventFixture, request } from './fixtures.js';
import { large, grow } from './large-fixtures.js';
it('preserves exact batch262144 and record66048 bounds independently of carrier nodes', () => {
  const f = eventFixture(100000); const batch = large(f.binding); grow(batch, 262144);
  expect(validate('EventBatch', batch).ok).toBe(true); expect(Buffer.byteLength(JSON.stringify(batch))).toBe(262144);
  const operation = captureEventOperation({ kind: 'eventIngest', request: { binding: f.binding, after: 0, batch } });
  expect(Buffer.byteLength(JSON.stringify(operation))).toBeGreaterThan(262144);
  expect(f.store.execute(operation)).toMatchObject({ inserted: 0, state: { blockedReason: 'quota_exhausted' } });
  const first = batch.events[0]!; if (first.kind !== 'engine.result') throw new Error('fixture kind');
  first.payload.artifacts[0]!.relativePath += 'x';
  expect(() => checkedOperation({ kind: 'eventIngest', request: { binding: f.binding, after: 0, batch } })).toThrow('Storage invalid_input');
  const maximum = large(f.binding, 1); grow(maximum, 66048, true);
  expect(() => captureEventOperation({ kind: 'eventIngest', request: { binding: f.binding, after: 0, batch: maximum } })).not.toThrow();
  const exact = eventFixture(100000);
  expect(exact.store.execute({ kind: 'eventIngest', request: { binding: exact.binding, after: 0, batch: maximum } }))
    .toMatchObject({ inserted: 1, state: { retainedBytes: 66176 } });
  const overflow = large(f.binding, 1); grow(overflow, 66049, true);
  expect(validate('EventBatch', overflow).ok).toBe(true);
  expect(() => captureEventOperation({ kind: 'eventIngest', request: { binding: f.binding, after: 0, batch: overflow } })).toThrow();
});
it('accepts schema-valid batches above4096 nodes and rejects original node/depth/collection overflow', () => {
  const f = eventFixture(); const batch = large(f.binding, 10);
  const nodes = (value: unknown): number => value !== null && typeof value === 'object'
    ? 1 + Object.values(value).reduce<number>((sum, child) => sum + nodes(child), 0) : 1;
  expect(nodes(batch)).toBeGreaterThan(4096);
  expect(validate('EventBatch', batch).ok).toBe(true);
  expect(() => captureEventOperation({ kind: 'eventIngest', request: { binding: f.binding, after: 0, batch } })).not.toThrow();
  let deep: unknown = null; for (let index = 0; index < 65; index++) deep = [deep];
  const excessNodes = Array.from({ length: 16 }, () => Array<null>(4096).fill(null));
  for (const invalid of [deep, excessNodes, Array<null>(4097).fill(null), { extra: Infinity }]) {
    expect(() => checkedOperation({ kind: 'eventIngest', request: { binding: f.binding, after: 0, batch: invalid } })).toThrow('Storage invalid_input');
  }
});
it('rejects carrier/body accessors, extra fields and malformed compact replies without invoking getters', () => {
  const f = eventFixture(); const getter = vi.fn(); const original = request(f.binding);
  for (const field of ['binding', 'after', 'batch']) {
    const input = { ...original }; Object.defineProperty(input, field, { enumerable: true, get: getter });
    expect(() => captureEventOperation({ kind: 'eventIngest', request: input })).toThrow();
  }
  const operation = { kind: 'eventIngest' as const, request: original };
  Object.defineProperty(operation, 'kind', { enumerable: true, get: getter });
  expect(() => checkedOperation(operation)).toThrow('Storage invalid_input');
  expect(operationMessageLimit(operation)).toBe(65_536); expect(getter).not.toHaveBeenCalled();
  const state = f.store.execute({ kind: 'eventLoad', binding: f.binding });
  for (const patch of [{ durableThrough: 1 }, { ackConfirmedThrough: 1 }, { retainedBytes: 1 },
    { coverage: 'partial' }, { blockedReason: 'cursor_expired' }, { retainedStartSeq: 3 }, { extra: true }]) {
    expect(() => captureEventReply({ kind: 'eventLoad', binding: f.binding }, { ...state, ...patch })).toThrow();
  }
});

it('rejects success replies that fail to confirm issued ACK or retain requested blockage', () => {
  const f = eventFixture(); f.store.execute({ kind: 'eventIngest', request: request(f.binding) });
  const state = f.store.execute({ kind: 'eventLoad', binding: f.binding });
  expect(() => captureEventReply({ kind: 'eventConfirmAck', request: { binding: f.binding,
    throughSeq: 1, receipt: ack(f.binding, 1) } }, state)).toThrow();
  expect(() => captureEventReply({ kind: 'eventProblem', request: { binding: f.binding,
    after: 1, kind: 'missing_receipt' } }, state)).toThrow();
});
