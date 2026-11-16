import { expect, it } from 'vitest';
import type { EventBatch } from '@beetle/contracts';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import { EVENT_ROW_ALLOWANCE, prepareEventBatch } from '../../../src/domain/events/index.js';
import { binding, events, otherId, repeated } from './fixture.js';

it('owns canonical records and exact UTF-8 accounting without projecting execution', () => {
  const bound = binding();
  const input = { binding: { ...bound, key: { ...bound.key } }, after: 0, batch: events() };
  const result = prepareEventBatch(input);
  expect(result.records).toHaveLength(input.batch.events.length);
  for (const [index, record] of result.records.entries()) {
    expect(record.canonical).toBe(encodeCanonicalJson(input.batch.events[index], 66048));
    expect(record.chargedBytes).toBe(Buffer.byteLength(record.canonical) + EVENT_ROW_ALLOWANCE);
  }
  input.binding.key.runId = '00000000-0000-4000-8000-000000000088';
  input.batch.events[0]!.observedAt = '2026-01-02T00:00:00Z';
  expect(result.binding.key.runId).toBe(otherId);
  expect(JSON.parse(result.records[0]!.canonical).phase).toBe('execute');
  expect(Object.isFrozen(result.records[0])).toBe(true);
  expect(Object.keys(result)).toEqual(['binding', 'after', 'nextCursor', 'retainedStartSeq', 'records']);
});

it('ignores object field order while retaining exact event identity and payload', () => {
  const value = events();
  const event = Object.fromEntries(Object.entries(value.events[0]!).reverse());
  const changed = { ...value, events: [event, ...value.events.slice(1)] };
  expect(prepareEventBatch({ binding: binding(), after: 0, batch: changed }))
    .toEqual(prepareEventBatch({ binding: binding(), after: 0, batch: value }));
});

it.each(['organizationId', 'workspaceId', 'attemptId', 'generation'] as const)('rejects wrong batch %s', field => {
  const batch = { ...events(), [field]: field === 'generation' ? 2 : otherId };
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch })).toThrow('identity_mismatch');
});

it('validates every event and nested engine-result identity including intent digest', () => {
  for (const field of ['workspaceId', 'intentDigest'] as const) {
    const batch = events();
    const result = batch.events.find(event => event.kind === 'engine.result')!;
    const payload = result.payload as Record<string, unknown>;
    payload[field] = field === 'intentDigest' ? 'b'.repeat(64) : otherId;
    expect(validate('EventBatch', batch).ok).toBe(field !== 'intentDigest');
    expect(() => prepareEventBatch({ binding: binding(), after: 0, batch }))
      .toThrow(field === 'intentDigest' ? 'invalid_batch' : 'identity_mismatch');
  }
  const batch = events(); batch.events[1]!.attemptId = otherId;
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch })).toThrow('identity_mismatch');
});

it.each(['gap', 'reverse', 'duplicate', 'cursor-leap', 'cursor-behind'])( 'rejects %s instead of manufacturing a contiguous prefix', change => {
  const batch = events();
  if (change === 'gap') batch.events[0]!.seq = 2;
  if (change === 'reverse') batch.events.reverse();
  if (change === 'duplicate') batch.events[1]!.seq = batch.events[0]!.seq;
  if (change === 'cursor-leap') batch.nextCursor++;
  if (change === 'cursor-behind') batch.nextCursor--;
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch })).toThrow('sequence_gap');
});

it('preserves an empty caught-up batch and safe maximum cursor without claiming stream closure', () => {
  const batch: EventBatch = { ...events(), events: [], nextCursor: Number.MAX_SAFE_INTEGER,
    retainedStartSeq: Number.MAX_SAFE_INTEGER };
  expect(prepareEventBatch({ binding: binding(), after: Number.MAX_SAFE_INTEGER, batch }))
    .toMatchObject({ after: Number.MAX_SAFE_INTEGER, nextCursor: Number.MAX_SAFE_INTEGER, records: [] });
  batch.events = [events().events[0]!];
  expect(() => prepareEventBatch({ binding: binding(), after: Number.MAX_SAFE_INTEGER, batch })).toThrow('sequence_gap');
});

it('rejects expiry and empty-batch cursor lies without skipping missing events', () => {
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch: { ...events(), retainedStartSeq: 2 } }))
    .toThrow('cursor_expired');
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch: { ...events(), events: [], nextCursor: 1 } }))
    .toThrow('sequence_gap');
});

it('accepts producer maximum100 and rejects schema-valid101 records', () => {
  expect(prepareEventBatch({ binding: binding(), after: 0, batch: repeated(100) }).records).toHaveLength(100);
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch: repeated(101) })).toThrow('invalid_batch');
});
