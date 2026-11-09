import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { DispatchObservation } from '../../src/ports/dispatch.js';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { captureDispatchOperation, captureDispatchReply, dispatchOperation,
  dispatchReplyLimit } from '../../src/adapters/outbound/sqlite/dispatch-wire.js';
import type { DispatchOperation } from '../../src/adapters/outbound/sqlite/dispatch-wire.js';
import { enqueue, seedFoundation, snapshotFor } from './execution-foundation-fixtures.js';

let db: DatabaseSync;
let original: ReturnType<typeof enqueue>;
beforeEach(() => { db = initialize(':memory:'); original = enqueue(db, seedFoundation(db)); });
afterEach(() => db.close());

it('captures complete private commands without taking ownership of caller data', () => {
  const input: DispatchOperation = { kind: 'dispatchObserve', request: {
    key: original.key, snapshot: snapshotFor(original.key),
  } };
  const captured = captureDispatchOperation(input);
  (original.key as { runId: string }).runId = '00000000-0000-4000-8000-000000000999';
  expect(captured).not.toEqual(input);
  expect(captureDispatchOperation({ kind: 'dispatchScan', query: { lane: 'queued', limit: 32 } }))
    .toEqual({ kind: 'dispatchScan', query: { lane: 'queued', limit: 32 } });
});

it.each(['kind', 'request'])('rejects %s accessors without invoking them', field => {
  const getter = vi.fn(() => field === 'kind' ? 'dispatchObserve' : { key: original.key, snapshot: snapshotFor(original.key) });
  const value = { kind: 'dispatchObserve' };
  Object.defineProperty(value, field, { enumerable: true, get: getter });
  if (field === 'kind') expect(dispatchOperation(value)).toBe(false);
  expect(() => captureDispatchOperation(value as DispatchOperation)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('accepts only the declared worker envelope fields and safe message identity', () => {
  const base = { kind: 'dispatchClaim', key: original.key } as const;
  expect(captureDispatchOperation({ ...base, messageId: 1 } as DispatchOperation)).toEqual({ ...base, messageId: 1 });
  for (const extra of [{ messageId: 0 }, { messageId: 0.5 }, { messageId: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }]) {
    expect(() => captureDispatchOperation({ ...base, ...extra } as DispatchOperation)).toThrow();
  }
});

it('rejects invalid original observation identity and semantic cursors before issue', () => {
  for (const patch of [{ generation: 2 }, { intentDigest: 'f'.repeat(64) }, { lastSeq: 0, retainedStartSeq: 2 }]) {
    expect(() => captureDispatchOperation({ kind: 'dispatchObserve', request: {
      key: original.key, snapshot: snapshotFor(original.key, patch),
    } })).toThrow();
  }
  expect(() => captureDispatchOperation({ kind: 'dispatchObserve', request: {
    key: original.key, snapshot: { invalid: 'x'.repeat(75_777) },
  } })).toThrow();
});

it.each([0, 33, 1.5])('rejects scan limit %s', limit => {
  expect(() => captureDispatchOperation({ kind: 'dispatchScan', query: { lane: 'queued', limit } })).toThrow();
});

it('measures cursor bounds in UTF8 bytes and closes scan query fields', () => {
  const query = { lane: 'reconcile' as const, limit: 1, cursor: 'π'.repeat(512) };
  expect(captureDispatchOperation({ kind: 'dispatchScan', query })).toEqual({ kind: 'dispatchScan', query });
  expect(() => captureDispatchOperation({ kind: 'dispatchScan', query: { ...query, cursor: 'π'.repeat(513) } })).toThrow();
  expect(() => captureDispatchOperation({ kind: 'dispatchScan', query: { ...query, extra: true } } as DispatchOperation)).toThrow();
});

it('bounds pages and validates every key, eligibility and continuation', () => {
  const operation: DispatchOperation = { kind: 'dispatchScan', query: { lane: 'queued', limit: 1 } };
  const item = { key: original.key, order: 1, after: 'opaque', eligibility: { kind: 'ready' } };
  expect(captureDispatchReply(operation, { items: [item], nextCursor: null })).toEqual({ items: [item], nextCursor: null });
  for (const page of [
    { items: [item, item], nextCursor: null }, { items: [], nextCursor: 'opaque' },
    { items: [item], nextCursor: 'different' },
    { items: [{ ...item, order: Number.MAX_SAFE_INTEGER + 1 }], nextCursor: null },
    { items: [{ ...item, after: 'x'.repeat(1025) }], nextCursor: null },
    { items: [{ ...item, eligibility: { kind: 'blocked', reason: 'invented' } }], nextCursor: null },
    { items: [{ ...item, key: { ...original.key, attempt: { ...original.key.attempt, generation: 2 } } }], nextCursor: null },
  ]) expect(() => captureDispatchReply(operation, page)).toThrow();
});

it('accepts a full-size original config through the dedicated Offer reply budget', () => {
  const operation: DispatchOperation = { kind: 'dispatchReadOffer', key: original.key };
  const config = { padding: 'x'.repeat(1_048_562) };
  expect(Buffer.byteLength(encodeJson(config, 1_048_576))).toBe(1_048_576);
  const reply = { key: original.key, offer: { ...original.offer, config } };
  expect(Buffer.byteLength(encodeJson(reply, dispatchReplyLimit(operation)))).toBeGreaterThan(1_048_576);
  expect(captureDispatchReply(operation, reply)).toEqual(reply);
  expect(() => captureDispatchReply(operation, { ...reply, key: { ...original.key, runId: original.key.attempt.attemptId } })).toThrow();
  expect(() => captureDispatchReply(operation, { ...reply, offer: { ...reply.offer, intentDigest: 'f'.repeat(64) } })).toThrow();
  expect(() => captureDispatchReply(operation, { ...reply, offer: { ...reply.offer, config: { padding: 'x'.repeat(1_048_577) } } })).toThrow();
});

it('binds claimed/replay identity and closes every compact claim result', () => {
  const operation: DispatchOperation = { kind: 'dispatchClaim', key: original.key };
  for (const value of [{ kind: 'claimed', key: original.key }, { kind: 'replay', key: original.key },
    { kind: 'acknowledged' }, { kind: 'blocked', reason: 'ownership_unknown' }]) {
    expect(captureDispatchReply(operation, value)).toEqual(value);
  }
  for (const value of [{ kind: 'success' }, { kind: 'acknowledged', extra: true },
    { kind: 'blocked', reason: 'invented' }, { kind: 'claimed', key: { ...original.key, runId: original.key.attempt.attemptId } }]) {
    expect(() => captureDispatchReply(operation, value)).toThrow();
  }
});

it('binds observation Run/snapshot identity and validates copied reply values', () => {
  const operation: DispatchOperation = { kind: 'dispatchObserve', request: { key: original.key, snapshot: snapshotFor(original.key) } };
  const value: DispatchObservation = { run: original.run, snapshot: snapshotFor(original.key), executionCharged: true, runChanged: false };
  const captured = captureDispatchReply(operation, value);
  expect(captured).toEqual(value); expect(captured).not.toBe(value);
  for (const reply of [{ ...value, executionCharged: 1 }, { ...value, runChanged: null },
    { ...value, snapshot: { ...value.snapshot, generation: 2 } },
    { ...value, run: { ...value.run, id: original.key.attempt.attemptId } },
    { ...value, run: { ...value.run, scope: { ...value.run.scope, workspaceId: original.key.attempt.attemptId } } }]) {
    expect(() => captureDispatchReply(operation, reply)).toThrow();
  }
});
