import { expect, it } from 'vitest';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import type { EventBatch } from '@beetle/contracts';
import { captureEventBinding, EVENT_BATCH_BYTES, EVENT_RECORD_BYTES, prepareEventBatch } from '../../../src/domain/events/index.js';
import { binding, events, otherId } from './fixture.js';

function sizedRecord(bytes: number): EventBatch {
  const source = events(); const event = source.events.find(value => value.kind === 'engine.result')!;
  event.seq = 1;
  const artifacts = Array.from({ length: 100 }, (_, i) => ({ ...event.payload.artifacts[0]!,
    artifactId: `00000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`, relativePath: String(i) }));
  event.payload.artifacts = artifacts;
  let remaining = bytes - Buffer.byteLength(encodeCanonicalJson(event, EVENT_BATCH_BYTES));
  expect(remaining).toBeGreaterThanOrEqual(0);
  for (const artifact of artifacts) {
    const extra = Math.min(remaining, 512 - artifact.relativePath.length);
    artifact.relativePath += 'a'.repeat(extra); remaining -= extra;
  }
  expect(remaining).toBe(0);
  expect(Buffer.byteLength(encodeCanonicalJson(event, EVENT_BATCH_BYTES))).toBe(bytes);
  return { ...source, events: [event], nextCursor: 1 };
}

it('accepts the producer record maximum and rejects a schema-valid byte overflow', () => {
  const maximum = sizedRecord(EVENT_RECORD_BYTES);
  expect(validate('EventBatch', maximum).ok).toBe(true);
  expect(prepareEventBatch({ binding: binding(), after: 0, batch: maximum }).records[0]!.chargedBytes)
    .toBe(EVENT_RECORD_BYTES + 128);
  const overflow = sizedRecord(EVENT_RECORD_BYTES + 1);
  expect(validate('EventBatch', overflow).ok).toBe(true);
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch: overflow })).toThrow('invalid_batch');
});

it('rejects aggregate byte overflow even when every event independently fits', () => {
  const value = sizedRecord(EVENT_RECORD_BYTES - 100);
  const batch = { ...value, events: Array.from({ length: 4 }, (_, i) => ({ ...value.events[0]!, seq: i + 1 })), nextCursor: 4 };
  expect(Buffer.byteLength(JSON.stringify(batch))).toBeGreaterThan(EVENT_BATCH_BYTES);
  expect(validate('EventBatch', batch).ok).toBe(true);
  expect(() => prepareEventBatch({ binding: binding(), after: 0, batch })).toThrow('invalid_batch');
});

it('charges UTF-8 bytes rather than string code units', () => {
  const batch = events(); const event = batch.events.find(value => value.kind === 'case.result')!;
  event.payload.caseKey = '🪲 café';
  const record = prepareEventBatch({ binding: binding(), after: 0, batch }).records.find(value => value.seq === event.seq)!;
  expect(record.chargedBytes).toBe(new TextEncoder().encode(record.canonical).byteLength + 128);
  expect(record.chargedBytes).toBeGreaterThan(record.canonical.length + 128);
});

it.each(['binding', 'after', 'batch'] as const)('rejects the carrier %s accessor without reading it', field => {
  const input = { binding: binding(), after: 0, batch: events() }; let reads = 0;
  Object.defineProperty(input, field, { enumerable: true, get() { reads++; throw new Error('synthetic canary'); } });
  expect(() => prepareEventBatch(input)).toThrow('invalid_batch'); expect(reads).toBe(0);
});

it('rejects oversized/extra carrier fields before traversing the batch', () => {
  let reads = 0; const batch = events();
  Object.defineProperty(batch, 'canary', { enumerable: true, get() { reads++; return 'synthetic'; } });
  const input = { binding: binding(), after: 0, batch, padding: 'x'.repeat(EVENT_BATCH_BYTES) };
  expect(() => prepareEventBatch(input)).toThrow('invalid_batch'); expect(reads).toBe(0);
});

it('rejects deep, oversized, cyclic and nonfinite JSON without exposing diagnostics', () => {
  let deep: unknown = 0;
  for (let depth = 0; depth < 66; depth++) deep = { child: deep };
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const batch of [deep, cyclic, { value: 'x'.repeat(EVENT_BATCH_BYTES) }, { value: Infinity }]) {
    expect(() => prepareEventBatch({ binding: binding(), after: 0, batch })).toThrow('invalid_batch');
  }
});

it('bounds carrier proxy errors without exposing caller diagnostics', () => {
  const input = new Proxy({ binding: binding(), after: 0, batch: events() }, {
    getPrototypeOf() { throw new Error('synthetic private canary'); },
  });
  expect(() => prepareEventBatch(input)).toThrow('Event batch invalid_batch');
});

it.each([-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid starting cursor %s', after => {
  expect(() => prepareEventBatch({ binding: binding(), after, batch: events() })).toThrow('invalid_batch');
});

it('captures strict binding and rejects authority aliases, stale generations and missing identities', () => {
  expect(Object.isFrozen(captureEventBinding(binding()).key.attempt)).toBe(true);
  const original = { ...binding(), journalAuthority: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  for (const input of [{ ...original, journalAuthority: `urn:uuid:${original.journalAuthority}` },
    { ...original, journalAuthority: original.journalAuthority.toUpperCase() },
    { ...original, key: { ...original.key, attempt: { ...original.key.attempt, generation: 2 } } },
    { ...original, extra: true }, { ...original, key: { runId: otherId } }]) {
    expect(() => captureEventBinding(input)).toThrow('invalid_binding');
  }
});
