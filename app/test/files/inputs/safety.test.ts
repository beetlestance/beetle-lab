import { execFileSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalInputBytes } from '../../../src/adapters/outbound/files/inputs/index.js';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { context, finish, fixture, record } from './fixture.js';
import type { Fixture } from './fixture.js';

describe('private filesystem input boundaries', () => {
  let files: Fixture;
  afterEach(async () => { await files?.dispose(); });

  it('requires canonical distinct private sibling roots and pins root identity across calls', async () => {
    files = await fixture(); const alias = join(files.root, 'alias'); await symlink(files.stagingRoot, alias);
    await expect(openLocalInputBytes({ stagingRoot: alias, publishedRoot: files.publishedRoot })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(openLocalInputBytes({ stagingRoot: files.stagingRoot, publishedRoot: files.stagingRoot })).rejects.toMatchObject({ code: 'invalid_input' });
    await mkdir(join(files.stagingRoot, 'nested'), { mode: 0o700 });
    await expect(openLocalInputBytes({ stagingRoot: files.stagingRoot, publishedRoot: join(files.stagingRoot, 'nested') })).rejects.toMatchObject({ code: 'invalid_input' });
    await rename(files.stagingRoot, join(files.root, 'original')); await mkdir(files.stagingRoot, { mode: 0o700 });
    await expect(finish(files.store.prepare(record(), context))).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects permissive root, generated directory and file modes', async () => {
    files = await fixture(); await chmod(files.stagingRoot, 0o755);
    await expect(files.reopen()).rejects.toMatchObject({ code: 'integrity' }); await chmod(files.stagingRoot, 0o700);
    const input = record(Buffer.from('a')); await files.seed(input, Buffer.from('a'));
    await chmod(dirname(files.path(input)), 0o755);
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
    await chmod(dirname(files.path(input)), 0o700); await chmod(files.path(input), 0o644);
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(Buffer.from('a'));
  });

  it('rejects a final symlink, a symlink parent and a special FIFO without following or opening them', async () => {
    let opens = 0; files = await fixture({ ...nativePort, open: async (path, flags, mode) => {
      if (path === files.path(input)) opens++; return nativePort.open(path, flags, mode);
    } });
    const input = record(Buffer.from('a')); const owned = join(files.root, 'synthetic-unowned');
    await writeFile(owned, Buffer.from('a'), { mode: 0o600 }); await mkdir(dirname(files.path(input)), { recursive: true, mode: 0o700 });
    await symlink(owned, files.path(input));
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(owned)).toEqual(Buffer.from('a')); await unlink(files.path(input));
    execFileSync('mkfifo', ['-m', '600', files.path(input)]);
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' }); expect(opens).toBe(0);
    await unlink(files.path(input)); const directory = dirname(files.path(input));
    await rename(directory, directory + '-retained'); await symlink(directory + '-retained', directory);
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
  });

  it('rejects a hardlinked staging file and refuses deletion with unexplained third-party links', async () => {
    files = await fixture(); const bytes = Buffer.from('a'); const input = record(bytes); await files.seed(input, bytes);
    const extra = join(files.root, 'unowned-link'); await link(files.path(input), extra);
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
    input.state = 'deleting'; await expect(finish(files.store.remove(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect((await lstat(files.path(input))).nlink).toBe(2); expect(await readFile(extra)).toEqual(bytes);
  });

  it('detects generated ancestor replacement during an original write without refreshing away its identity', async () => {
    let replaced = false;
    files = await fixture({ ...nativePort, write: async (handle, bytes, position) => {
      const count = await nativePort.write(handle, bytes, position);
      if (!replaced) {
        replaced = true; const organization = join(files.stagingRoot, input.scope.organizationId);
        await rename(organization, organization + '-retained'); await mkdir(organization, { mode: 0o700 });
      }
      return count;
    } });
    const input = record(Buffer.from('abc'));
    await expect(finish(files.store.append(input, 0, async () => Buffer.from('abc'), context))).rejects.toMatchObject({ code: 'integrity' });
    expect(replaced).toBe(true);
  });

  it('detects ancestor replacement during link and never unlinks through the replacement', async () => {
    files = await fixture({ ...nativePort, link: async (source, destination) => {
      await nativePort.link(source, destination);
      const organization = join(files.publishedRoot, input.scope.organizationId);
      await rename(organization, organization + '-retained'); await mkdir(organization, { mode: 0o700 });
    } });
    const bytes = Buffer.from('abc'); const input = record(bytes); input.state = 'publishing'; input.offset = input.bytes;
    await files.seed(input, bytes);
    await expect(finish(files.store.publish(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(bytes); expect((await lstat(files.path(input))).nlink).toBe(2);
  });

  it('detects a file replaced between name inspection and the original open', async () => {
    let replaced = false;
    files = await fixture({ ...nativePort, open: async (path, flags, mode) => {
      if (!replaced && path === files.path(input)) {
        replaced = true; await rename(path, path + '-retained'); await writeFile(path, Buffer.from('evil'), { mode: 0o600 });
      }
      return nativePort.open(path, flags, mode);
    } });
    const input = record(Buffer.from('safe')); await files.seed(input, Buffer.from('safe')); input.offset = 4;
    await expect(finish(files.store.prepare(input, context))).rejects.toMatchObject({ code: 'integrity' });
    expect(await readFile(files.path(input))).toEqual(Buffer.from('evil'));
  });
});
