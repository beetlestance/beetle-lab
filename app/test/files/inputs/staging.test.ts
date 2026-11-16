import { lstat, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openLocalInputBytes } from '../../../src/adapters/outbound/files/inputs/index.js';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { context, deferred, finish, fixture, record } from './fixture.js';
import type { Fixture } from './fixture.js';

describe('native input staging', () => {
  let files: Fixture;
  afterEach(async () => { await files?.dispose(); });

  it('exclusively prepares private durable directories and an empty file, including reopen', async () => {
    const syncKinds: string[] = [];
    files = await fixture({ ...nativePort, sync: async handle => {
      syncKinds.push((await handle.stat()).isDirectory() ? 'directory' : 'file'); await nativePort.sync(handle);
    } });
    const input = record(); await finish(files.store.prepare(input, context));
    expect((await lstat(files.path(input))).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(files.path(input)))).mode & 0o777).toBe(0o700);
    expect(syncKinds).toContain('file'); expect(syncKinds.filter(kind => kind === 'directory').length).toBeGreaterThanOrEqual(7);
    const reopened = await openLocalInputBytes(files); await finish(reopened.prepare(input, context));
    expect(await readFile(files.path(input))).toEqual(Buffer.alloc(0));
  });

  it('streams UTF8 chunks, preserves committed prefix and compares identical earlier retries', async () => {
    files = await fixture(); const bytes = Buffer.from('first ☃ second'); const input = record(bytes);
    const first = bytes.subarray(0, 7); const source = vi.fn(async () => first);
    expect(await finish(files.store.append(input, 0, source, context))).toBe(7); expect(source).toHaveBeenCalledTimes(1);
    input.offset = 7;
    expect(await finish(files.store.append(input, 0, async () => first, context))).toBe(7);
    expect(await finish(files.store.append(input, 7, async () => bytes.subarray(7), context))).toBe(bytes.byteLength);
    expect(await readFile(files.path(input))).toEqual(bytes);
  });

  it('rejects changed, partial overlap and gaps without changing committed bytes', async () => {
    files = await fixture(); const bytes = Buffer.from('abcdef'); const input = record(bytes); input.offset = 4;
    await files.seed(input, bytes.subarray(0, 4));
    const gap = vi.fn(async () => Buffer.from('f'));
    await expect(finish(files.store.append(input, 5, gap, context))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(gap).not.toHaveBeenCalled();
    await expect(finish(files.store.append(input, 3, async () => Buffer.from('de'), context))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(finish(files.store.append(input, 0, async () => Buffer.from('x'), context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(bytes.subarray(0, 4));
  });

  it('flushes truncation of excess crash tail before appending to the committed offset', async () => {
    let truncated = false; let flushed = false;
    files = await fixture({ ...nativePort,
      truncate: async (handle, length) => { await nativePort.truncate(handle, length); truncated = true; },
      sync: async handle => { await nativePort.sync(handle); if (truncated) flushed = true; },
      write: async (handle, bytes, position) => { expect(truncated && flushed).toBe(true); return nativePort.write(handle, bytes, position); },
    });
    const bytes = Buffer.from('abcdef'); const input = record(bytes); input.offset = 3;
    await files.seed(input, Buffer.from('abcLOST'));
    expect(await finish(files.store.append(input, 3, async () => bytes.subarray(3), context))).toBe(6);
    expect(await readFile(files.path(input))).toEqual(bytes);
  });

  it('never synthesizes a committed prefix and fails a short custody file', async () => {
    files = await fixture(); const input = record(Buffer.from('abc')); input.offset = 2;
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'custody_missing' });
    await files.seed(input, Buffer.from('a'));
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(Buffer.from('a'));
  });

  it.each([0, 65_537])('rejects a %i byte source before native content writes', async length => {
    const write = vi.fn(nativePort.write); files = await fixture({ ...nativePort, write });
    const input = record(new Uint8Array(65_536));
    await expect(finish(files.store.append(input, 0, async () => new Uint8Array(length), context))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(write).not.toHaveBeenCalled(); await expect(lstat(files.path(input))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('copies mutable chunk bytes before the first asynchronous native operation', async () => {
    const gate = deferred(); const entered = deferred(); let held = false;
    files = await fixture({ ...nativePort, statfs: async (...args) => {
      if (!held) { held = true; entered.resolve(); await gate.promise; }
      return nativePort.statfs(...args);
    } });
    const bytes = Buffer.from('abc'); const input = record(bytes);
    const job = files.store.append(input, 0, async () => bytes, context);
    await entered.promise; bytes.fill(120); gate.resolve(); await finish(job);
    expect(await readFile(files.path(input))).toEqual(Buffer.from('abc'));
  });

  it('captures scope, record and context before awaits and isolates a second scoped input', async () => {
    files = await fixture(); const bytes = Buffer.from('abc'); const input = record(bytes); const original = record(bytes);
    const sourceGate = deferred<Uint8Array>(); const started = deferred();
    const options = { freeSpaceReserveBytes: 0 };
    const job = files.store.append(input, 0, () => { started.resolve(); return sourceGate.promise; }, options);
    await started.promise; input.scope.organizationId = '../escape'; input.sha256 = '0'.repeat(64); options.freeSpaceReserveBytes = Number.MAX_SAFE_INTEGER;
    sourceGate.resolve(bytes); await finish(job); expect(await readFile(files.path(original))).toEqual(bytes);
    const other = record(bytes); other.scope.workspaceId = '55555555-5555-4555-8555-555555555555';
    await finish(files.store.append(other, 0, async () => Buffer.from('xyz'), context));
    expect(await readFile(files.path(original))).toEqual(bytes); expect(await readFile(files.path(other))).toEqual(Buffer.from('xyz'));
  });

  it('rejects invalid record identities and nonstaging prepare without consuming a body', async () => {
    files = await fixture(); const input = record(Buffer.from('a')); const source = vi.fn(async () => Buffer.from('a'));
    input.id = '../outside'; await expect(finish(files.store.append(input, 0, source, context))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(source).not.toHaveBeenCalled(); input.id = record().id; input.state = 'published';
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('checks BigInt statfs reserves and reports fixed ENOSPC failures', async () => {
    files = await fixture({ ...nativePort, statfs: async (...args) => {
      const value = await nativePort.statfs(...args); return { ...value, bavail: 0n, bsize: 4096n } as typeof value;
    } });
    await expect(finish(files.store.prepare(record(), { freeSpaceReserveBytes: 1 }))).rejects.toMatchObject({ code: 'capacity_unavailable', message: 'Input byte operation failed' });
    const store = await files.reopen({ ...nativePort, write: async () => { throw Object.assign(new Error('private synthetic path'), { code: 'ENOSPC' }); } });
    await expect(finish(store.append(record(Buffer.from('a')), 0, async () => Buffer.from('a'), context))).rejects.toMatchObject({ code: 'capacity_unavailable', message: 'Input byte operation failed' });
  });

  it('handles short original writes and does not advance after a sync fault', async () => {
    let writes = 0;
    files = await fixture({ ...nativePort, write: (handle, bytes, position) => {
      writes++; return nativePort.write(handle, bytes.subarray(0, 1), position);
    } });
    const input = record(Buffer.from('abc'));
    expect(await finish(files.store.append(input, 0, async () => Buffer.from('abc'), context))).toBe(3); expect(writes).toBe(3);
    await writeFile(files.path(input), Buffer.from('abc'));
    const failing = await files.reopen({ ...nativePort, sync: async () => { throw new Error('private sync fault'); } });
    await expect(finish(failing.prepare(input, context))).rejects.toMatchObject({ code: 'io' });
    expect(input.offset).toBe(0);
  });
});
