import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { promises as realFs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DurationHistogram } from '../../aggregation/index.js';
import type { MetricWindow } from '../../aggregation/index.js';
import { MetricArchive } from '../../wrapper/attempt/archive/index.js';
import { MetricFiles } from '../../wrapper/attempt/archive/files.js';
import { AttemptFence } from '../../wrapper/attempt/fence.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof fs>(); return { ...actual, open: vi.fn(actual.open) };
});
const cleanups: (() => Promise<unknown> | void)[] = [];
beforeEach(() => { vi.mocked(fs.open).mockImplementation(realFs.open); });
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
async function fixture(allowance = 4_194_304) {
  const root = await fs.mkdtemp('/private/tmp/beetle-metric-archive-');
  cleanups.push(() => realFs.rm(root, { recursive: true, force: true }));
  const fence = new AttemptFence({ wall: () => 100_000, monotonic: () => performance.now() }, new AbortController().signal, 30_000);
  cleanups.push(() => fence.dispose());
  const scope = { organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: '00000000-0000-4000-8000-000000000003', generation: 1 };
  const options = { directory: root, uid: process.getuid!(), allowance, scope, fence };
  const archive = await MetricArchive.create(options); let closeFailure = false;
  cleanups.push(async () => {
    if (closeFailure) await expect(archive.close()).rejects.toMatchObject({ reason: 'cleanup' });
    else await archive.close();
  });
  return { root, fence, archive, options, expectCloseFailure: () => { closeFailure = true; } };
}
function window(start = 1000, request = 'r0'): MetricWindow {
  const distribution = new DurationHistogram(); for (const point of [0, 1, 4, 9]) distribution.record(point);
  return { startTimeMs: start, endTimeMs: start + 1000, series: [{ metric: 'http_req_duration', kind: 'trend',
    tags: { phase: 'execute', request }, scope: 'execute', total: { kind: 'trend', count: 4, sum: 14, min: 0, max: 9,
      mean: 3.5, distribution: distribution.snapshot() } }] };
}
it('binds exact record offsets, histograms, gaps and index/footer hashes after native close', async () => {
  const f = await fixture(); const windows = [window(), window(4000, 'request-unicode-请求')];
  for (const value of windows) await f.archive.append(value);
  const evidence = await f.archive.finish(); expect(evidence.windows).toBe(2);
  expect(Object.isFrozen(evidence.artifacts)).toBe(true);
  const files = await Promise.all(evidence.artifacts.map(async artifact => {
    const bytes = await fs.readFile(join(f.root, artifact.relativePath));
    expect(bytes.byteLength).toBe(artifact.bytes); expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact.sha256);
    expect((await fs.stat(join(f.root, artifact.relativePath))).mode & 0o777).toBe(0o600); return bytes;
 }));
  const data = files[0]!; const index = files[1]!.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  expect(index[0]).toMatchObject({ scope: f.options.scope, dataArtifactId: evidence.dataArtifactId, version: 1 });
  for (let i = 0; i < windows.length; i++) {
    const position = index[i + 1]!; assert(typeof position.offset === 'number' && typeof position.length === 'number');
    expect(JSON.parse(data.subarray(position.offset, position.offset + position.length).toString('utf8')))
      .toEqual({ kind: 'window', sequence: i + 1, window: windows[i] });
  }
  expect(index.at(-1)).toMatchObject({ kind: 'end', windows: 2, dataBytes: data.byteLength, dataSha256: evidence.artifacts[0]!.sha256 });
  expect(evidence.bytes).toBe(files[0]!.byteLength + files[1]!.byteLength);
  expect(await f.archive.finish()).toBe(evidence);
  await expect(f.archive.append(window(5000))).rejects.toMatchObject({ reason: 'artifact' });
});
it('seals an empty history without inventing samples', async () => {
  const f = await fixture(); const evidence = await f.archive.finish();
  expect(evidence.windows).toBe(0); expect(evidence.artifacts).toHaveLength(2);
  expect((await fs.readFile(join(f.root, 'metric-windows.ndjson'), 'utf8')).trimEnd().split('\n')).toHaveLength(2);
});
it('reserves footer room and refuses over-budget history without a seal', async () => {
  const f = await fixture(65536); let accepted = 0;
  try { for (let i = 0; i < 1000; i++) { await f.archive.append(window(i * 1000)); accepted++; } }
  catch (error) { expect(error).toMatchObject({ reason: 'output_limit' }); }
  expect(accepted).toBeGreaterThan(0); expect(accepted).toBeLessThan(1000);
  await expect(f.archive.finish()).rejects.toMatchObject({ reason: 'output_limit' });
  expect((await fs.stat(join(f.root, 'metric-windows.ndjson'))).size).toBeLessThanOrEqual(65536);
});
it('bounds collect-only growth while retaining earlier execute history', async () => {
  const f = await fixture(); for (let i = 0; i < 20; i++) await f.archive.append(window(i * 1000));
  const before = f.archive.bytes; f.archive.beginCollection(1024);
  await expect(f.archive.append(window(21_000))).rejects.toMatchObject({ reason: 'output_limit' });
  expect(f.archive.bytes).toBe(before);
});
it.each(['overlap', 'length', 'frame'] as const)('rejects %s without publishing partial history', async mode => {
  const f = await fixture(); await f.archive.append(window());
  const next = mode === 'overlap' ? window() : mode === 'length' ? { ...window(2000), endTimeMs: 2001 }
    : window(2000, 'x'.repeat(1_048_576));
  await expect(f.archive.append(next)).rejects.toMatchObject({ reason: mode === 'frame' ? 'output_limit' : 'artifact' });
  await expect(f.archive.finish()).rejects.toMatchObject({ reason: mode === 'frame' ? 'output_limit' : 'artifact' });
});
it.each(['data', 'index'] as const)('rejects changed %s bytes during streamed seal verification', async lane => {
  const f = await fixture(); await f.archive.append(window());
  const handle = await realFs.open(join(f.root, lane === 'data' ? 'metric-windows.ndjson' : 'metric-index.ndjson'), 'r+');
  await handle.write(Buffer.from('X'), 0, 1, 0); await handle.close();
  await expect(f.archive.finish()).rejects.toMatchObject({ reason: 'artifact' });
});
function partialWrites(handle: FileHandle): FileHandle {
  return new Proxy(handle, { get(target, key) {
    if (key === 'write') return async (buffer: unknown, offset: unknown, length: unknown, position: unknown) => {
      assert(buffer instanceof Uint8Array && typeof offset === 'number' && typeof length === 'number' && typeof position === 'number');
      return target.write(buffer, offset, Math.max(1, Math.floor(length / 2)), position);
    };
    const value: unknown = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
it('handles bounded native partial writes using exact byte positions', async () => {
  vi.mocked(fs.open).mockImplementation(async (...args) => partialWrites(await realFs.open(...args)));
  const f = await fixture(); await f.archive.append(window());
  const evidence = await f.archive.finish(); const bytes = await fs.readFile(join(f.root, 'metric-windows.ndjson'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(evidence.artifacts[0]!.sha256);
});
it('refuses overlapping work and close retains a held native write through cancellation', async () => {
  const gate = deferred(); const entered = deferred(); let hold = false; let closed = 0;
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args); const write = file.write.bind(file); const close = file.close.bind(file);
    if (String(args[0]).endsWith('metric-windows.ndjson')) {
      vi.spyOn(file, 'write').mockImplementation(async (...parameters) => { if (hold) { entered.resolve(); await gate.promise; } return write(...parameters); });
      vi.spyOn(file, 'close').mockImplementation(async () => { closed++; await close(); });
    }
    return file;
  });
  const f = await fixture(); hold = true; const append = f.archive.append(window());
  const rejected = expect(append).rejects.toMatchObject({ reason: 'cancelled' });
  try {
    await entered.promise; await expect(f.archive.finish()).rejects.toMatchObject({ code: 'busy' });
    f.fence.stop('cancelled');
    const closing = f.archive.close(); expect(f.archive.close()).toBe(closing);
    let done = false; void closing.then(() => { done = true; }); await Promise.resolve(); await Promise.resolve();
    expect(done).toBe(false); expect(closed).toBe(0); gate.resolve(); await rejected; await closing; expect(closed).toBe(1);
  } finally { gate.resolve(); await append.catch(() => undefined); }
});
it('rejects replacement of the named output root while retaining its original descriptors for close', async () => {
  const f = await fixture(); await f.archive.append(window());
  const moved = f.root + '-retained';
  await realFs.rename(f.root, moved); cleanups.unshift(() => realFs.rm(moved, { recursive: true, force: true }));
  await realFs.mkdir(f.root, { mode: 0o700 });
  await expect(f.archive.finish()).rejects.toMatchObject({ reason: 'artifact' }); await f.archive.close();
});
it('refuses an existing symlink without touching its synthetic target', async () => {
  const f = await fixture(); await f.archive.close();
  const target = join(f.root, 'synthetic-canary'); await realFs.writeFile(target, 'preserved', { mode: 0o600 });
  await realFs.unlink(join(f.root, 'metric-windows.ndjson')); await realFs.symlink(target, join(f.root, 'metric-windows.ndjson'));
  await expect(MetricArchive.create(f.options)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await realFs.readFile(target, 'utf8')).toBe('preserved');
});
it('streams final verification for retained history larger than the parser buffer', async () => {
  const f = await fixture(32 * 1_048_576); const first = window();
  const series = Array.from({ length: 64 }, (_, request) => ({ ...first.series[0]!, tags: { phase: 'execute' as const, request: `r${request}` } }));
  for (let i = 0; i < 512; i++) await f.archive.append({ startTimeMs: i * 1000, endTimeMs: (i + 1) * 1000, series });
  const evidence = await f.archive.finish(); expect(evidence.windows).toBe(512); expect(evidence.bytes).toBeGreaterThan(8 * 1_048_576);
  expect((await fs.stat(join(f.root, 'metric-windows.ndjson'))).size).toBe(evidence.artifacts[0]!.bytes);
}, 10_000);
it('withholds sealed evidence until the original native close settles', async () => {
  const gate = deferred(); const entered = deferred();
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args); const close = file.close.bind(file);
    if (String(args[0]).endsWith('metric-windows.ndjson')) {
      vi.spyOn(file, 'close').mockImplementation(async () => { entered.resolve(); await gate.promise; await close(); });
    }
    return file;
  });
  const f = await fixture(); await f.archive.append(window()); let completed = false;
  const finishing = f.archive.finish().then(value => { completed = true; return value; });
  try {
    await entered.promise; expect(completed).toBe(false);
    await expect(f.archive.append(window(2000))).rejects.toMatchObject({ code: 'busy' });
    gate.resolve(); expect((await finishing).windows).toBe(1);
  } finally { gate.resolve(); await finishing; }
});
it('preserves a native close failure as failed quiescence without a descriptor', async () => {
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    const file = await realFs.open(...args); const close = file.close.bind(file);
    if (String(args[0]).endsWith('metric-windows.ndjson')) {
      vi.spyOn(file, 'close').mockImplementation(async () => { await close(); throw new Error('Synthetic close failure'); });
    }
    return file;
  });
  const f = await fixture(); f.expectCloseFailure(); await f.archive.append(window());
  await expect(f.archive.finish()).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.archive.quiescence).toBe('failed');
  await expect(f.archive.finish()).rejects.toMatchObject({ reason: 'cleanup' });
});
it('bounds the protocol record counter before another storage issue (storage mocked)', async () => {
  const f = await fixture(32 * 1_048_576); let writes = 0;
  const append = vi.spyOn(MetricFiles.prototype, 'append').mockImplementation(async () => { writes++; });
  for (let i = 0; i < 65536; i++) {
    await f.archive.append({ startTimeMs: i * 1000, endTimeMs: (i + 1) * 1000, series: [] });
    if (i % 256 === 0) append.mockClear();
  }
  const before = writes;
  await expect(f.archive.append({ startTimeMs: 65_536_000, endTimeMs: 65_537_000, series: [] })).rejects.toMatchObject({ reason: 'output_limit' });
  expect(writes).toBe(before);
}, 10_000);
