import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ControlEvent } from '@beetle/contracts';
import { copyWrapperBatch, copyWrapperCheckpoint, copyWrapperCursor, CONTROL_FILE_BYTES } from '../../src/control-protocol/index.js';
import type { WrapperBatch, WrapperCheckpoint } from '../../src/control-protocol/index.js';
let progress: ControlEvent;
beforeAll(async () => { progress = JSON.parse(await readFile('contracts/fixtures/valid/wrapper-progress.json', 'utf8')) as ControlEvent; });
function batch(count = 1): WrapperBatch {
  const { attemptId, organizationId, workspaceId, generation } = progress;
  const events = Array.from({ length: count }, (_, index) => ({ ...structuredClone(progress), seq: index + 1 }));
  const raw = events.map(event => JSON.stringify(event) + '\n').join('');
  return { key: { attemptId, organizationId, workspaceId, generation }, expected: null,
    next: { version: 1, dev: '18446744073709551615', ino: '9223372036854775809', offset: Buffer.byteLength(raw),
      wrapperSeq: count, prefixSha256: createHash('sha256').update(raw).digest('hex') }, events };
}
it.each([1, 100])('copies %s contiguous frames without narrowing high-bit identities', count => {
  const input = batch(count); const copied = copyWrapperBatch(input); expect(copied).toEqual(input);
  expect(copied).not.toBe(input); expect(copied.events[0]).not.toBe(input.events[0]);
  expect(Object.isFrozen(copied)).toBe(true); expect(Object.isFrozen(copied.events[0]!.payload)).toBe(true);
  input.events[0]!.observedAt = '2026-01-02T00:00:00Z'; expect(copied.events[0]!.observedAt).not.toBe(input.events[0]!.observedAt);
});
it.each(['-1', '01', '1e3', '18446744073709551616', 'x', ''])('rejects noncanonical/overflow identity %s', ino => {
  expect(() => copyWrapperCursor({ ...batch().next, ino })).toThrow();
});
it.each([0, -1, 1.5, CONTROL_FILE_BYTES + 1])('rejects invalid next offset %s', offset => {
  expect(() => copyWrapperBatch({ ...batch(), next: { ...batch().next, offset } })).toThrow();
});
it.each([0, 101])('rejects invalid batch event count %s', count => { expect(() => copyWrapperBatch(batch(count))).toThrow(); });
it('rejects sequence gaps, cursor disagreement, wrong scope and unknown properties', () => {
  const input = batch();
  for (const changed of [{ ...input, events: [{ ...input.events[0], seq: 2 }] },
    { ...input, next: { ...input.next, wrapperSeq: 2 } },
    { ...input, key: { ...input.key, generation: input.key.generation + 1 } },
    { ...input, extra: true }, { ...input, next: { ...input.next, extra: true } }]) {
    expect(() => copyWrapperBatch(changed)).toThrow();
  }
});
it('preserves expected checkpoint identity and rejects changed-file transitions', () => {
  const first = batch(); const expected: WrapperCheckpoint = { ...first.next, lastBatchDigest: 'a'.repeat(64) };
  const next = { ...first.next, wrapperSeq: 2, offset: first.next.offset * 2 };
  const input = { ...first, expected, next, events: [{ ...first.events[0]!, seq: 2 }] };
  expect(copyWrapperBatch(input)).toEqual(input);
  expect(() => copyWrapperBatch({ ...input, next: { ...next, ino: '1' } })).toThrow();
  expect(() => copyWrapperCheckpoint({ ...expected, lastBatchDigest: 'A'.repeat(64) })).toThrow();
});
it('rejects oversized input without invoking accessors', () => {
  let invoked = false;
  const accessor = Object.defineProperty(batch(), 'events', { enumerable: true, get() { invoked = true; throw new Error('fixture'); } });
  expect(() => copyWrapperBatch(accessor)).toThrow(); expect(invoked).toBe(false);
  expect(() => copyWrapperBatch({ ...batch(), extra: 'x'.repeat(262144) })).toThrow();
});
it('rejects nested result identity mismatch before worker effects', async () => {
  const input = batch(); const result = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as Record<string, unknown>;
  result.attemptId = '00000000-0000-4000-8000-000000000099';
  const event = { ...input.events[0], kind: 'engine.result', payload: result };
  expect(() => copyWrapperBatch({ ...input, events: [event] })).toThrow();
});
