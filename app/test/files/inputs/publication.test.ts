import { link, lstat, mkdir, readFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import type { NativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { context, finish, fixture, record } from './fixture.js';
import type { Fixture } from './fixture.js';

describe('native no-overwrite input publication', () => {
  let files: Fixture;
  afterEach(async () => { await files?.dispose(); });

  it('publishes stage-only custody with durable parents, then recovers destination-only custody', async () => {
    files = await fixture(); const bytes = Buffer.from('synthetic ☃'); const input = record(bytes);
    input.offset = bytes.byteLength; input.state = 'publishing'; await files.seed(input, bytes);
    await finish(files.store.publish(input, context));
    await expect(lstat(files.path(input))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(files.path(input, true))).nlink).toBe(1);
    expect(await readFile(files.path(input, true))).toEqual(bytes);
    const reopened = await files.reopen(); await finish(reopened.publish(input, context));
    expect((await lstat(files.path(input, true))).nlink).toBe(1);
  });

  it.each(['link', 'destination-sync', 'source-unlink', 'source-sync'] as const)(
    'reopens metadata-independent custody after original %s completes but acknowledgement fails', async phase => {
      const paths = new Map<FileHandle, string>(); let linked = false; let unlinked = false; let failed = false;
      const fault = () => { if (!failed) { failed = true; throw new Error('controlled interrupted acknowledgement'); } };
      const port: NativePort = { ...nativePort,
        open: async (path, flags, mode) => { const handle = await nativePort.open(path, flags, mode); paths.set(handle, String(path)); return handle; },
        link: async (source, destination) => { await nativePort.link(source, destination); linked = true; if (phase === 'link') fault(); },
        unlink: async path => { await nativePort.unlink(path); unlinked = true; if (phase === 'source-unlink') fault(); },
        sync: async handle => {
          await nativePort.sync(handle); const path = paths.get(handle);
          if (phase === 'destination-sync' && linked && path === dirname(files.path(input, true))) fault();
          if (phase === 'source-sync' && unlinked && path === dirname(files.path(input))) fault();
        },
      };
      files = await fixture(port); const bytes = Buffer.from('restart byte evidence'); const input = record(bytes);
      input.offset = input.bytes; input.state = 'publishing'; await files.seed(input, bytes);
      await expect(finish(files.store.publish(input, context))).rejects.toMatchObject({ code: 'io' });
      expect(failed).toBe(true); const reopened = await files.reopen(); await finish(reopened.publish(input, context));
      expect(await readFile(files.path(input, true))).toEqual(bytes); expect((await lstat(files.path(input, true))).nlink).toBe(1);
      await expect(lstat(files.path(input))).rejects.toMatchObject({ code: 'ENOENT' });
    });

  it.each(['new-directory-sync', 'new-file-sync'] as const)('recovers staging after %s acknowledgement loss', async phase => {
    let made = false; let failed = false;
    files = await fixture({ ...nativePort,
      mkdir: async (path, options) => { const result = await nativePort.mkdir(path, options); made = true; return result; },
      sync: async handle => {
        await nativePort.sync(handle); const directory = (await handle.stat()).isDirectory();
        if (!failed && made && (phase === 'new-directory-sync' ? directory : !directory)) {
          failed = true; throw new Error('controlled interrupted sync acknowledgement');
        }
      },
    });
    const input = record(); await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'io' });
    expect(failed).toBe(true); const reopened = await files.reopen(); await finish(reopened.prepare(input, context));
    expect(await readFile(files.path(input))).toEqual(Buffer.alloc(0));
  });

  it('recovers exactly two deterministic aliases and leaves a single-link destination', async () => {
    files = await fixture(); const bytes = Buffer.from('alias bytes'); const input = record(bytes);
    input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, bytes); await mkdir(dirname(files.path(input, true)), { recursive: true, mode: 0o700 });
    await link(files.path(input), files.path(input, true));
    expect((await lstat(files.path(input))).nlink).toBe(2); await finish(files.store.publish(input, context));
    expect((await lstat(files.path(input, true))).nlink).toBe(1); expect(await readFile(files.path(input, true))).toEqual(bytes);
  });

  it('rejects distinct inodes even when both names have the expected bytes', async () => {
    files = await fixture(); const bytes = Buffer.from('same bytes'); const input = record(bytes);
    input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, bytes); await files.seed(input, bytes, true);
    const before = [await lstat(files.path(input)), await lstat(files.path(input, true))];
    await expect(finish(files.store.publish(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect((await lstat(files.path(input))).ino).toBe(before[0]?.ino);
    expect((await lstat(files.path(input, true))).ino).toBe(before[1]?.ino);
    expect(await readFile(files.path(input))).toEqual(bytes); expect(await readFile(files.path(input, true))).toEqual(bytes);
  });

  it('rejects a third link without unlinking any name', async () => {
    files = await fixture(); const bytes = Buffer.from('third link'); const input = record(bytes);
    input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, bytes); await mkdir(dirname(files.path(input, true)), { recursive: true, mode: 0o700 });
    await link(files.path(input), files.path(input, true)); const extra = join(files.root, 'unowned'); await link(files.path(input), extra);
    await expect(finish(files.store.publish(input, context))).rejects.toMatchObject({ code: 'integrity' });
    for (const path of [files.path(input), files.path(input, true), extra]) expect((await lstat(path)).nlink).toBe(3);
  });

  it('classifies EEXIST evidence instead of replacing or blindly retrying an unexpected destination', async () => {
    let calls = 0;
    files = await fixture({ ...nativePort, link: async (source, destination) => {
      calls++; await nativePort.link(source, destination);
      throw Object.assign(new Error('controlled acknowledgement conflict'), { code: 'EEXIST' });
    } });
    const bytes = Buffer.from('existing'); const input = record(bytes); input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, bytes); await finish(files.store.publish(input, context)); expect(calls).toBe(1);
    expect((await lstat(files.path(input, true))).nlink).toBe(1);
  });

  it('rejects a late distinct destination reported by EEXIST and preserves it', async () => {
    files = await fixture({ ...nativePort, link: async (_source, destination) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(destination, Buffer.from('intruder'), { mode: 0o600, flag: 'wx' });
      throw Object.assign(new Error('controlled occupied name'), { code: 'EEXIST' });
    } });
    const bytes = Buffer.from('expected'); const input = record(bytes); input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, bytes);
    await expect(finish(files.store.publish(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input, true))).toEqual(Buffer.from('intruder')); expect(await readFile(files.path(input))).toEqual(bytes);
  });

  it('reconstructs only exact empty publishing evidence and rejects missing nonempty/published custody', async () => {
    files = await fixture(); const empty = record(); empty.state = 'publishing';
    await finish(files.store.publish(empty, context)); expect(await readFile(files.path(empty, true))).toEqual(Buffer.alloc(0));
    const badEmpty = record(); badEmpty.id = '66666666-6666-4666-8666-666666666666'; badEmpty.state = 'publishing'; badEmpty.sha256 = '0'.repeat(64);
    await expect(finish(files.store.publish(badEmpty, context))).rejects.toMatchObject({ code: 'integrity' });
    const missing = record(Buffer.from('missing')); missing.state = 'publishing'; missing.offset = missing.bytes;
    await expect(finish(files.store.publish(missing, context))).rejects.toMatchObject({ code: 'custody_missing' });
    const published = record(); published.state = 'published'; published.id = badEmpty.id;
    await expect(finish(files.store.publish(published, context))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(lstat(files.path(published, true))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects wrong digest/size before promotion and leaves corrupt stage for explicit deletion', async () => {
    files = await fixture(); const input = record(Buffer.from('expected')); input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, Buffer.from('corrupted'));
    await expect(finish(files.store.publish(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(Buffer.from('corrupted'));
    await expect(lstat(files.path(input, true))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['link', 'directory-sync'] as const)('fails closed on unsupported native %s without success fallback', async phase => {
    files = await fixture(); const bytes = Buffer.from('native failure'); const input = record(bytes);
    input.state = 'publishing'; input.offset = input.bytes; await files.seed(input, bytes);
    const port: NativePort = { ...nativePort,
      link: phase === 'link' ? async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); } : nativePort.link,
      sync: async handle => {
        if (phase === 'directory-sync' && (await handle.stat()).isDirectory()) throw Object.assign(new Error('unsupported'), { code: 'EINVAL' });
        await nativePort.sync(handle);
      },
    };
    const failing = await files.reopen(port); await expect(finish(failing.publish(input, context))).rejects.toMatchObject({ code: 'io' });
    expect(await readFile(files.path(input))).toEqual(bytes); await expect(lstat(files.path(input, true))).rejects.toMatchObject({ code: 'ENOENT' });
    await finish((await files.reopen()).publish(input, context));
  });
});
