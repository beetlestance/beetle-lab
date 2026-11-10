import { describe, expect, it } from 'vitest';
import { truncate, writeFile } from 'node:fs/promises';
import { rangeFixture, tracking } from './fixture.js';
import type { OutputRangeOptions } from '../../src/collection/output/index.js';

describe('native selected bounded bytes and synchronous capture', () => {
  const f = rangeFixture();
  it('reads multiple exact ranges, a short final range and owned bytes without unrelated reads', async () => {
    const body = Buffer.from(Array.from({ length: 150_003 }, (_, i) => i % 251));
    const artifact = await f.artifact('reports/data.bin', body);
    await f.artifact('unrelated.bin', 'unread');
    const t = tracking({ chunk: 997 }); const options = await f.rangeOptions(artifact);
    for (const offset of [0, 65_536, 131_072]) {
      const result = await f.range({ ...options, offset }, t.ports).result;
      expect(result.ok).toBe(true);
      if (result.ok) expect(Buffer.from(result.value)).toEqual(body.subarray(offset, offset + 65_536));
    }
    expect(t.reads.every(read => read.path === f.path('reports/data.bin') && read.requested <= 65_536)).toBe(true);
    expect(t.reads.reduce((sum, read) => sum + read.bytes, 0)).toBe(body.length);
    expect(t.opened).not.toContain(f.path()); expect(t.opened).not.toContain(f.path('unrelated.bin'));
    expect(t.closed.length).toBe(t.opened.length);
  });
  it.each(['', 'body'])('opens and closes actual file at EOF for %j without any payload read', async body => {
    const artifact = await f.artifact('data.bin', body); const t = tracking();
    const result = await f.range(await f.rangeOptions(artifact, { offset: artifact.bytes }), t.ports).result;
    expect(result).toEqual({ ok: true, value: new Uint8Array() });
    expect(t.reads).toHaveLength(0); expect(t.opened).toEqual([f.directory(), f.path('data.bin')]);
    expect(t.closed.length).toBe(2);
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])('rejects invalid offset %s before IO', async offset => {
    const artifact = await f.artifact('data.bin', 'body'); const t = tracking();
    expect(await f.range(await f.rangeOptions(artifact, { offset }), t.ports).result).toEqual({ ok: false, reason: 'invalid_options' });
    expect(t.opened).toHaveLength(0);
  });
  it.each([0, 65_537, 1.5, Number.MAX_SAFE_INTEGER])('rejects invalid length %s', async length => {
    const artifact = await f.artifact('data.bin', 'body');
    expect(await f.range(await f.rangeOptions(artifact, { length })).result).toEqual({ ok: false, reason: 'invalid_options' });
  });
  it('accepts safe integer EOF on an actual sparse file without reading it', async () => {
    const artifact = await f.artifact('data.bin', '');
    const bytes = 2 ** 32 + 19; await truncate(f.path('data.bin'), bytes); artifact.bytes = bytes;
    const t = tracking();
    expect(await f.range(await f.rangeOptions(artifact, { offset: bytes }), t.ports).result).toEqual({ ok: true, value: new Uint8Array() });
    expect(t.reads).toHaveLength(0);
  });
  it('rejects beyond EOF and exact size mismatch, including zero EOF', async () => {
    const artifact = await f.artifact('data.bin', 'body'); const options = await f.rangeOptions(artifact); const t = tracking();
    expect(await f.range({ ...options, offset: 5 }, t.ports).result).toEqual({ ok: false, reason: 'invalid_options' });
    expect(t.opened).toHaveLength(0);
    for (const bytes of [0, 3, 5]) {
      expect(await f.range({ ...options, artifact: { ...artifact, bytes } }, t.ports).result).toEqual({ ok: false, reason: 'integrity' });
    }
    expect(t.reads).toHaveLength(0);
  });
  it.each(['../outside', '/absolute', 'a//b', 'a/./b', 'a/../b', 'é.bin'])('uses shared artifact grammar for %s', async relativePath => {
    const artifact = await f.artifact('data.bin', 'body'); const t = tracking();
    expect(await f.range(await f.rangeOptions({ ...artifact, relativePath }), t.ports).result).toEqual({ ok: false, reason: 'invalid_options' });
    expect(t.opened).toHaveLength(0);
  });
  it.each(['options', 'root', 'artifact'])('rejects %s accessors without invocation', async target => {
    const artifact = await f.artifact('data.bin', 'body'); const options = structuredClone(await f.rangeOptions(artifact));
    let calls = 0;
    const object = target === 'options' ? options : options[target as 'root' | 'artifact'];
    Object.defineProperty(object, target === 'options' ? 'deadline' : target === 'root' ? 'inode' : 'relativePath', {
      enumerable: true, get() { calls++; return 'bad'; },
    });
    expect(await f.range(options).result).toEqual({ ok: false, reason: 'invalid_options' }); expect(calls).toBe(0);
  });
  it('owns root/artifact/scalars before returning and keeps provisional bytes independent of expected hash', async () => {
    const artifact = await f.artifact('data.bin', 'body'); const options = structuredClone(await f.rangeOptions(artifact));
    await writeFile(f.path('data.bin'), 'EDIT');
    const operation = f.range(options);
    Reflect.set(options.root, 'inode', '0'); Reflect.set(options.artifact, 'relativePath', '../bad');
    Reflect.set(options, 'offset', 999); Reflect.set(options, 'deadline', 0);
    const result = await operation.result; expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.value).toString()).toBe('EDIT');
  });
  it.each([NaN, Infinity, performance.now() + 600_000])('rejects invalid deadline %s', async deadline => {
    const artifact = await f.artifact('data.bin', 'body'); const t = tracking();
    expect(await f.range(await f.rangeOptions(artifact, { deadline }), t.ports).result).toEqual({ ok: false, reason: 'invalid_options' });
    expect(t.opened).toHaveLength(0);
  });
  it('rejects malformed nested data safely', async () => {
    const artifact = await f.artifact('data.bin', 'body'); const options = await f.rangeOptions(artifact);
    for (const change of [{ root: null }, { artifact: null }, { signal: {} }, { artifact: { ...artifact, extra: true } }]) {
      expect(await f.range({ ...options, ...change } as unknown as OutputRangeOptions).result).toEqual({ ok: false, reason: 'invalid_options' });
    }
  });
  it('bounds root and artifact strings before native IO or shared structural validation', async () => {
    const artifact = await f.artifact('data.bin', 'body'); const options = await f.rangeOptions(artifact); const t = tracking();
    for (const change of [{ root: { ...options.root, directory: `/${'a'.repeat(4096)}` } },
      { artifact: { ...artifact, kind: 'a'.repeat(4097) } }]) {
      expect(await f.range({ ...options, ...change }, t.ports).result).toEqual({ ok: false, reason: 'invalid_options' });
    }
    expect(t.opened).toHaveLength(0);
  });
});
