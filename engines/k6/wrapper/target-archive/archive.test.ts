import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AppendFiles } from '../artifact-custody/index.js';
import { TargetArchive } from './index.js';
import { deferred, fixture, sample } from './fixtures.test-support.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function create(allowance?: number) { const f = await fixture(allowance); cleanups.push(f.dispose); return f; }
it('retains immutable, independently verifiable prefixes without an in-memory sample corpus', async () => {
  const f = await create(); expect(f.archive.completedPrefix()).toBeUndefined();
  await f.archive.append(sample()); const first = f.archive.completedPrefix()!;
  for (const part of [first, first.scope, first.data]) expect(Object.isFrozen(part)).toBe(true);
  await f.archive.append(sample(1)); const second = f.archive.completedPrefix()!;
  expect(first.samples).toBe(1); expect(second.samples).toBe(2);
  expect(first.data.artifactId).toBe(second.data.artifactId);
  expect(await fs.readdir(f.root)).toEqual(['target-samples.ndjson']);
  const bytes = await fs.readFile(join(f.root, first.data.relativePath));
  for (const prefix of [first, second]) {
    expect(createHash('sha256').update(bytes.subarray(0, prefix.data.bytes)).digest('hex')).toBe(prefix.data.sha256);
    expect(bytes[prefix.data.bytes - 1]).toBe(10);
  }
  const records = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  expect(records).toEqual([{ format: 'beetle-target-samples', version: 1, scope: f.options.scope,
    artifactId: first.data.artifactId, intervalMs: 1000 }, { kind: 'sample', sequence: 1, sample: sample() },
    { kind: 'sample', sequence: 2, sample: sample(1) }]);
  expect(f.archive.bytes).toBe(bytes.length);
  expect((await fs.stat(join(f.root, first.data.relativePath))).mode & 0o777).toBe(0o600);
});
it('captures the caller sample before an asynchronous append can observe mutation', async () => {
  const f = await create(); const original = sample();
  const pending = f.archive.append(original);
  Object.assign(original, { phase: 'after' }); Object.assign(original.values, { rss: 999 });
  await pending;
  const lines = (await fs.readFile(join(f.root, 'target-samples.ndjson'), 'utf8')).trimEnd().split('\n');
  expect(JSON.parse(lines[1]!).sample).toMatchObject({ phase: 'before', values: { rss: 1 } });
});
it('refuses concurrent intake and retains the previous prefix while a real write is held', async () => {
  const f = await create(); await f.archive.append(sample()); const first = f.archive.completedPrefix();
  const gate = deferred(); const entered = deferred(); const append = AppendFiles.prototype.append;
  vi.spyOn(AppendFiles.prototype, 'append').mockImplementation(async function(this: AppendFiles, lane, bytes) {
    entered.resolve(); await gate.promise; return append.call(this, lane, bytes);
  });
  const pending = f.archive.append(sample(1));
  try {
    await entered.promise; expect(f.archive.completedPrefix()).toBe(first);
    await expect(f.archive.append(sample(2))).rejects.toMatchObject({ code: 'busy' });
  } finally { gate.resolve(); await pending; }
  expect(f.archive.completedPrefix()?.samples).toBe(2);
});
it('fences immediately on close and keeps ownership through the original write', async () => {
  const f = await create(); await f.archive.append(sample());
  const gate = deferred(); const entered = deferred(); const append = AppendFiles.prototype.append;
  vi.spyOn(AppendFiles.prototype, 'append').mockImplementation(async function(this: AppendFiles, lane, bytes) {
    entered.resolve(); await gate.promise; return append.call(this, lane, bytes);
  });
  const close = vi.spyOn(AppendFiles.prototype, 'close'); const pending = f.archive.append(sample(1));
  const rejection = expect(pending).rejects.toMatchObject({ reason: 'artifact' });
  await entered.promise; const closing = f.archive.close();
  expect(f.archive.close()).toBe(closing); expect(f.archive.completedPrefix()).toBeUndefined();
  let closed = false; void closing.then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false); expect(close).not.toHaveBeenCalled();
  gate.resolve(); await rejection; await closing; expect(close).toHaveBeenCalledOnce();
});
it('retains charged failed bytes and withdraws the prefix after a partial append failure', async () => {
  const f = await create(); await f.archive.append(sample()); const before = f.archive.bytes;
  const append = AppendFiles.prototype.append;
  vi.spyOn(AppendFiles.prototype, 'append').mockImplementation(async function(this: AppendFiles, lane, bytes) {
    await append.call(this, lane, bytes.subarray(0, 8)); throw Error('synthetic write failure');
  });
  await expect(f.archive.append(sample(1))).rejects.toMatchObject({ reason: 'artifact' });
  expect(f.archive.bytes).toBeGreaterThan(before); expect(f.archive.completedPrefix()).toBeUndefined();
  await expect(f.archive.append(sample(2))).rejects.toMatchObject({ reason: 'artifact' });
});
it('bounds record count before issuing another write', async () => {
  const f = await create(); const sync = vi.spyOn(AppendFiles.prototype, 'syncParent');
  for (let i = 0; i < 256; i++) await f.archive.append(sample(i));
  expect(f.archive.completedPrefix()?.samples).toBe(256);
  const bytes = f.archive.bytes; expect(bytes).toBeLessThanOrEqual(1048576);
  const append = vi.spyOn(AppendFiles.prototype, 'append');
  await expect(f.archive.append(sample(256))).rejects.toMatchObject({ reason: 'output_limit' });
  expect(append).not.toHaveBeenCalled(); expect(f.archive.bytes).toBe(bytes); expect(sync).not.toHaveBeenCalled();
});
it('refuses over-budget records before storage work and leaves no valid prefix', async () => {
  const f = await create(1024); const before = f.archive.bytes; const append = vi.spyOn(AppendFiles.prototype, 'append');
  await expect(f.archive.append(sample())).rejects.toMatchObject({ reason: 'output_limit' });
  expect(append).not.toHaveBeenCalled(); expect(f.archive.bytes).toBe(before); expect(f.archive.completedPrefix()).toBeUndefined();
});
it.each(['invalid', 'cancelled'] as const)('withdraws prefixes when %s', async mode => {
  const f = await create(); await f.archive.append(sample());
  if (mode === 'cancelled') { f.cancel(); expect(f.archive.completedPrefix()).toBeUndefined(); }
  else {
    await expect(f.archive.append({ ...sample(1), values: { ...sample(1).values, rss: -1 } })).rejects.toMatchObject({ reason: 'artifact' });
    expect(f.archive.completedPrefix()).toBeUndefined();
  }
});
it('refuses a pre-existing symlink without changing its target', async () => {
  const f = await create(); await f.archive.close();
  const path = join(f.root, 'target-samples.ndjson'); await fs.unlink(path);
  const canary = join(f.root, 'synthetic-canary'); await fs.writeFile(canary, 'preserved', { mode: 0o600 });
  await fs.symlink(canary, path);
  await expect(TargetArchive.create(f.options)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await fs.readFile(canary, 'utf8')).toBe('preserved');
});
