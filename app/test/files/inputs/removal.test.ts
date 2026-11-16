import { link, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { context, finish, fixture, record } from './fixture.js';
import type { Fixture } from './fixture.js';

describe('explicit input deletion', () => {
  let files: Fixture;
  afterEach(async () => { await files?.dispose(); });

  it('deletes corrupt bytes in two distinct exact owned single-link names without a hash requirement', async () => {
    files = await fixture(); const input = record(Buffer.from('expected')); input.state = 'deleting';
    await files.seed(input, Buffer.from('bad stage')); await files.seed(input, Buffer.from('bad destination'), true);
    await finish(files.store.remove(input, context));
    await expect(lstat(files.path(input))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(files.path(input, true))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(dirname(files.path(input)))).isDirectory()).toBe(true);
  });

  it('removes two deterministic aliases with the exact expected size and hash', async () => {
    files = await fixture(); const bytes = Buffer.from('expected'); const input = record(bytes); input.state = 'deleting';
    await files.seed(input, bytes);
    await mkdir(dirname(files.path(input, true)), { recursive: true, mode: 0o700 }); await link(files.path(input), files.path(input, true));
    await finish(files.store.remove(input, context));
    await expect(lstat(files.path(input))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(files.path(input, true))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['corrupt!', 'bad'])('preserves both deterministic aliases when their bytes are %s', async content => {
    files = await fixture(); const input = record(Buffer.from('expected')); input.state = 'deleting';
    const corrupt = Buffer.from(content); await files.seed(input, corrupt);
    await mkdir(dirname(files.path(input, true)), { recursive: true, mode: 0o700 }); await link(files.path(input), files.path(input, true));
    const before = await lstat(files.path(input), { bigint: true });
    await expect(finish(files.store.remove(input, context))).rejects.toMatchObject({ code: 'integrity' });
    for (const path of [files.path(input), files.path(input, true)]) {
      const after = await lstat(path, { bigint: true });
      expect(after.dev).toBe(before.dev); expect(after.ino).toBe(before.ino); expect(after.nlink).toBe(2n);
      expect(after.size).toBe(before.size); expect(after.mtimeNs).toBe(before.mtimeNs); expect(after.ctimeNs).toBe(before.ctimeNs);
      expect(await readFile(path)).toEqual(corrupt);
    }
    expect(input.state).toBe('deleting');
  });

  it('classifies both names before deleting either when one has an unexplained link', async () => {
    files = await fixture(); const input = record(Buffer.from('expected')); input.state = 'deleting';
    await files.seed(input, Buffer.from('stage')); await files.seed(input, Buffer.from('destination'), true);
    const extra = join(files.root, 'unowned'); await link(files.path(input, true), extra);
    await expect(finish(files.store.remove(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(Buffer.from('stage'));
    expect(await readFile(files.path(input, true))).toEqual(Buffer.from('destination')); expect((await lstat(extra)).nlink).toBe(2);
  });

  it('flushes parents on absence recovery without synthesizing input directories', async () => {
    let syncs = 0; files = await fixture({ ...nativePort, sync: async handle => { syncs++; await nativePort.sync(handle); } });
    const input = record(); input.state = 'deleting'; await finish(files.store.remove(input, context));
    expect(syncs).toBe(2); await expect(lstat(join(files.stagingRoot, input.scope.organizationId))).rejects.toMatchObject({ code: 'ENOENT' });
    await finish((await files.reopen()).remove(input, context));
  });

  it('leaves deletion recoverable after unlink acknowledgement loss or parent flush failure', async () => {
    files = await fixture(); const input = record(Buffer.from('a')); input.state = 'deleting'; await files.seed(input, Buffer.from('a'));
    const interrupted = await files.reopen({ ...nativePort, unlink: async path => { await nativePort.unlink(path); throw new Error('controlled lost acknowledgement'); } });
    await expect(finish(interrupted.remove(input, context))).rejects.toMatchObject({ code: 'io' });
    const failingSync = await files.reopen({ ...nativePort, sync: async () => { throw new Error('controlled directory sync failure'); } });
    await expect(finish(failingSync.remove(input, context))).rejects.toMatchObject({ code: 'io' });
    await finish((await files.reopen()).remove(input, context)); expect(input.state).toBe('deleting');
  });

  it('requires deleting state and preserves bytes for all other states', async () => {
    files = await fixture(); const input = record(Buffer.from('a')); await files.seed(input, Buffer.from('a'));
    await expect(finish(files.store.remove(input, context))).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await readFile(files.path(input))).toEqual(Buffer.from('a'));
  });
});
