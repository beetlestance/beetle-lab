import { describe, expect, it } from 'vitest';
import { appendFile, chmod, link, rename, truncate, writeFile } from 'node:fs/promises';
import { createControlReader, ControlReadError } from '../../src/collection/control/index.js';
import { fixture, tracking, value, ack } from './fixture.js';

describe('incremental filesystem intake', () => {
  const f = fixture();
  it('snapshots options, rejects noncanonical paths, and performs no constructor IO', async () => {
    const t = tracking(); const reader = f.reader(null, t.ports); expect(t.opens()).toBe(0);
    expect(() => createControlReader({ directory: `${f.directory()}/../x`, uid: 0, key: f.key(), checkpoint: null }))
      .toThrow(ControlReadError);
    expect(await value(reader)).toMatchObject({ kind: 'caught_up', cursor: null, consistency: 'live_provisional' });
    expect(t.opens()).toBe(1);
  });
  it('keeps one immutable pending request and requires an exact acknowledgement', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking(); const reader = f.reader(null, t.ports);
    const first = await value(reader); expect(first.kind).toBe('batch'); if (first.kind !== 'batch') return;
    expect(first.request.expected).toBeNull(); expect(Object.isFrozen(first.request.events[0]?.payload)).toBe(true);
    const calls = t.reads.length; expect(await value(reader)).toEqual(first); expect(t.reads).toHaveLength(calls);
    expect(() => reader.accept({ ...ack(first.request), offset: 0 })).toThrow(ControlReadError);
    expect(await value(reader)).toEqual(first); reader.accept(ack(first.request));
    expect(await value(reader)).toMatchObject({ kind: 'caught_up', cursor: first.request.next });
  });
  it('handles fragmented UTF8/LF and bounds each pass to eight original reads', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking(9); const reader = f.reader(null, t.ports);
    let found = false;
    for (let pass = 0; pass < 12; pass++) {
      const before = t.reads.length; const result = await value(reader);
      expect(t.reads.length - before).toBeLessThanOrEqual(8);
      if (result.kind === 'batch') { expect(result.request.events).toHaveLength(1); found = true; break; }
    }
    expect(found).toBe(true); expect(t.reads[1]?.position).toBe(9);
  });
  it('retains a live torn tail until completion, then verifies stopped collection', async () => {
    const raw = JSON.stringify(f.event()); await f.write(raw.slice(0, -1)); const reader = f.reader();
    expect(await value(reader)).toMatchObject({ kind: 'caught_up', tail: 'incomplete' });
    await appendFile(f.path(), `${raw.slice(-1)}\n`); const batch = await value(reader);
    expect(batch.kind).toBe('batch'); if (batch.kind !== 'batch') return;
    reader.accept(ack(batch.request));
    expect(await value(reader, true)).toMatchObject({ consistency: 'stopped_verified', tail: 'none' });
  });
  it('decodes a multibyte UTF8 codepoint split between original reads', async () => {
    const event = { ...f.event(), kind: 'case.result', payload: {
      caseKey: 'é', outcome: 'passed', durationMs: 1, required: true, artifactIds: [],
    } };
    const raw = `${JSON.stringify(event)}\n`; const split = Buffer.from(raw).indexOf(Buffer.from('é')) + 1;
    await f.write(raw); const t = tracking(split); const reader = f.reader(null, t.ports);
    const batch = await value(reader); expect(batch).toMatchObject({ kind: 'batch', request: { events: [event] } });
  });
  it('does not mistake a stopped fragmented budget boundary for a torn EOF', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking(11); const reader = f.reader(null, t.ports);
    let found = false;
    for (let pass = 0; pass < 10; pass++) {
      const result = await value(reader, true);
      if (result.kind === 'batch') { reader.accept(ack(result.request)); found = true; break; }
    }
    expect(found).toBe(true);
  });
  it('rejects stopped torn tails and missing stopped files', async () => {
    await f.write('{'); const reader = f.reader();
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result)
      .toEqual({ ok: false, reason: 'corruption' });
    await rename(f.path(), `${f.path()}.old`); const absent = f.reader();
    expect(await absent.read({ deadline: performance.now() + 5000, stopped: true }).result)
      .toEqual({ ok: false, reason: 'missing' });
  });
  it.each(['schema', 'scope', 'sequence', 'utf8', 'oversized'])('rejects invalid %s frames', async fault => {
    const event = f.event();
    const raw = { schema: '{"secret":"never echo this"}\n', scope: `${JSON.stringify({ ...event, generation: 2 })}\n`,
      sequence: `${JSON.stringify({ ...event, seq: 2 })}\n`, utf8: Buffer.from([0xff, 10]),
      oversized: `${' '.repeat(65_536)}\n` }[fault]!;
    await f.write(raw); const reader = f.reader();
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
      .toEqual({ ok: false, reason: 'corruption' });
  });
  it.each(['mode', 'link', 'replace', 'shrink'])('rejects %s custody changes', async fault => {
    await f.write(`${JSON.stringify(f.event())}\n`); const reader = f.reader(); const batch = await value(reader);
    if (batch.kind !== 'batch') throw new Error('expected batch'); reader.accept(ack(batch.request));
    if (fault === 'mode') await chmod(f.path(), 0o644);
    if (fault === 'link') await link(f.path(), `${f.path()}.link`);
    if (fault === 'replace') { await rename(f.path(), `${f.path()}.old`); await f.write(''); }
    if (fault === 'shrink') await truncate(f.path(), 0);
    const result = await reader.read({ deadline: performance.now() + 5000, stopped: false }).result;
    expect(result).toEqual({ ok: false, reason: fault === 'shrink' ? 'corruption' : 'custody' });
  });
  it('bounds event count, retains the excluded frame, and never rereads old intake', async () => {
    await f.write(Array.from({ length: 205 }, (_, index) => `${JSON.stringify(f.event(index + 1))}\n`).join(''));
    const t = tracking(); const reader = f.reader(null, t.ports); const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const batch = await value(reader); if (batch.kind !== 'batch') throw new Error('expected batch');
      counts.push(batch.request.events.length); reader.accept(ack(batch.request));
    }
    expect(counts).toEqual([100, 100, 5]);
    const previous = t.reads.at(-1)!.position;
    await value(reader); expect(t.reads.at(-1)!.position).toBe(previous);
  });
  it('detects edits after a cached stopped proof by checking metadata again', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const reader = f.reader(); const batch = await value(reader);
    if (batch.kind !== 'batch') throw new Error('expected batch'); reader.accept(ack(batch.request));
    expect(await value(reader, true)).toMatchObject({ consistency: 'stopped_verified' });
    await writeFile(f.path(), `${JSON.stringify({ ...f.event(), payload: { ...f.event().payload, completedUnits: 3 } })}\n`);
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result)
      .toEqual({ ok: false, reason: 'corruption' });
  });
});
