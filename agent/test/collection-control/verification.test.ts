import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFile, stat, writeFile, rename } from 'node:fs/promises';
import { fixture, tracking, value, ack, largeFrame } from './fixture.js';
import type { WrapperCheckpoint } from '../../src/control-protocol/index.js';

describe('bounded prefix consistency and frame admission', () => {
  const f = fixture();
  async function checkpoint(raw: string, seq: number): Promise<WrapperCheckpoint> {
    const s = await stat(f.path(), { bigint: true });
    return { version: 1, dev: s.dev.toString(), ino: s.ino.toString(), offset: Buffer.byteLength(raw), wrapperSeq: seq,
      prefixSha256: createHash('sha256').update(raw).digest('hex'), lastBatchDigest: 'a'.repeat(64) };
  }
  it('recovers a large prefix in bounded passes before admitting any new events', async () => {
    const raw = Array.from({ length: 1500 }, (_, index) => `${JSON.stringify(f.event(index + 1))}\n`).join('');
    await f.write(raw); const expected = await checkpoint(raw, 1500);
    const t = tracking(); const reader = f.reader(expected, t.ports); let passes = 0;
    for (;;) {
      const before = t.reads.length; const result = await value(reader); passes++;
      expect(result.kind).toBe('verifying');
      const reads = t.reads.slice(before); expect(reads.length).toBeLessThanOrEqual(8);
      expect(reads.reduce((total, read) => total + read.bytes, 0)).toBeLessThanOrEqual(262_144);
      if (result.kind === 'verifying' && result.verifiedBytes === expected.offset) break;
      expect(passes).toBeLessThan(10);
    }
    expect(passes).toBeGreaterThan(1);
    const before = t.reads.length; await value(reader); await value(reader);
    expect(t.reads.slice(before).map(read => read.position)).toEqual([expected.offset, expected.offset]);
    await appendFile(f.path(), `${JSON.stringify(f.event(1501))}\n`);
    const batch = await value(reader); expect(batch).toMatchObject({ kind: 'batch', request: { expected } });
  });
  it('allows append during restart but rejects changed old prefix', async () => {
    const raw = Array.from({ length: 1000 }, (_, index) => `${JSON.stringify(f.event(index + 1))}\n`).join('');
    await f.write(raw); const expected = await checkpoint(raw, 1000); const reader = f.reader(expected);
    const first = await value(reader); expect(first.kind).toBe('verifying');
    await appendFile(f.path(), `${JSON.stringify(f.event(1001))}\n`);
    let result = await value(reader);
    while (result.kind === 'verifying' && result.verifiedBytes < result.targetBytes) result = await value(reader);
    expect(await value(reader)).toMatchObject({ kind: 'batch' });
    await reader.close();
    await writeFile(f.path(), raw.replace('completedUnits":2', 'completedUnits":3'));
    const changed = f.reader(expected); let failure;
    for (let pass = 0; pass < 5; pass++) {
      const operation = changed.read({ deadline: performance.now() + 5000, stopped: false });
      failure = await operation.result; await operation.quiesced; if (!failure.ok) break;
    }
    expect(failure).toEqual({ ok: false, reason: 'corruption' });
  });
  it('detects a live prefix overwrite during stopped final verification', async () => {
    const raw = `${JSON.stringify(f.event())}\n`; await f.write(raw); const reader = f.reader();
    const batch = await value(reader); if (batch.kind !== 'batch') throw new Error('expected batch');
    reader.accept(ack(batch.request)); await writeFile(f.path(), raw.replace('completedUnits":2', 'completedUnits":3'));
    expect(await value(reader)).toMatchObject({ consistency: 'live_provisional' });
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result)
      .toEqual({ ok: false, reason: 'corruption' });
  });
  it('rejects a missing checkpoint file instead of adopting an empty stream', async () => {
    const raw = `${JSON.stringify(f.event())}\n`; await f.write(raw); const expected = await checkpoint(raw, 1);
    await rename(f.path(), `${f.path()}.old`); const reader = f.reader(expected);
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
      .toEqual({ ok: false, reason: 'missing' });
  });
  it('pins stopped metadata across bounded final passes', async () => {
    const raw = Array.from({ length: 1000 }, (_, index) => `${JSON.stringify(f.event(index + 1))}\n`).join('');
    await f.write(raw); const expected = await checkpoint(raw, 1000); const reader = f.reader(expected);
    let result = await value(reader);
    while (result.kind === 'verifying' && result.verifiedBytes < result.targetBytes) result = await value(reader);
    expect(await value(reader, true)).toMatchObject({ kind: 'verifying', phase: 'final' });
    await appendFile(f.path(), `${JSON.stringify(f.event(1001))}\n`);
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result)
      .toEqual({ ok: false, reason: 'corruption' });
  });
  it('completes a large stopped prefix over bounded passes', async () => {
    const raw = Array.from({ length: 1500 }, (_, index) => `${JSON.stringify(f.event(index + 1))}\n`).join('');
    await f.write(raw); const expected = await checkpoint(raw, 1500); const t = tracking();
    const reader = f.reader(expected, t.ports); let result = await value(reader);
    while (result.kind === 'verifying' && result.verifiedBytes < result.targetBytes) result = await value(reader);
    let passes = 0;
    for (;;) {
      const before = t.reads.length; result = await value(reader, true); passes++;
      const reads = t.reads.slice(before); expect(reads.length).toBeLessThanOrEqual(8);
      expect(reads.reduce((sum, read) => sum + read.bytes, 0)).toBeLessThanOrEqual(262_144);
      if (result.kind === 'caught_up') { expect(result.consistency).toBe('stopped_verified'); break; }
      expect(result).toMatchObject({ kind: 'verifying', phase: 'final' }); expect(passes).toBeLessThan(10);
    }
    expect(passes).toBeGreaterThan(1);
  });
  it('admits maximum LF-inclusive frames with normalized batch-envelope overhead', async () => {
    const maximum = await largeFrame(f.event());
    const raw = Array.from({ length: 4 }, (_, index) => `${JSON.stringify({ ...maximum, seq: index + 1 })}\n`).join('');
    expect(Buffer.byteLength(raw)).toBe(262_144); await f.write(raw);
    const t = tracking(); const reader = f.reader(null, t.ports);
    const first = await value(reader); if (first.kind !== 'batch') throw new Error('expected batch');
    expect(first.request.events).toHaveLength(3); expect(first.request.next.offset).toBe(196_608);
    expect(Buffer.byteLength(JSON.stringify(first.request))).toBeLessThanOrEqual(262_144);
    expect(t.reads.reduce((total, read) => total + read.bytes, 0)).toBeLessThanOrEqual(262_144);
    reader.accept(ack(first.request)); const second = await value(reader);
    expect(second).toMatchObject({ kind: 'batch', request: { next: { offset: 262_144, wrapperSeq: 4 } } });
    expect(t.reads.filter(read => read.position < 262_144)).toHaveLength(4);
  });
  it('rejects exponent normalization expanding a raw valid-size event beyond its encoded limit', async () => {
    const event = await largeFrame(f.event(), 65_521);
    const raw = JSON.stringify(event).replace('"bytes":1', '"bytes":1e15');
    expect(Buffer.byteLength(raw)).toBeLessThan(65_536); await f.write(`${raw}\n`);
    const reader = f.reader();
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
      .toEqual({ ok: false, reason: 'corruption' });
  });
  it('validates nested result scope through the shared protocol', async () => {
    const event = await largeFrame(f.event(), 65_000);
    if (event.kind !== 'engine.result') throw new Error('expected result fixture');
    event.payload.generation = 2; await f.write(`${JSON.stringify(event)}\n`); const reader = f.reader();
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
      .toEqual({ ok: false, reason: 'corruption' });
  });
});
