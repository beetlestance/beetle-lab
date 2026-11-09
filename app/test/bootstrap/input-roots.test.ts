import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeInputRoots, InputDirectoryError } from '../../src/bootstrap/input-roots.js';

describe('installation-owned input roots', () => {
  let root: string;
  beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-input-startup-'))); });
  afterEach(async () => { await chmod(root, 0o700); await rm(root, { recursive: true, force: true }); });
  it('creates private canonical sibling roots and adopts them on restart', async () => {
    const directory = join(root, 'inputs');
    const result = await initializeInputRoots(directory);
    expect(result).toEqual({ stagingRoot: join(directory, 'staging'), publishedRoot: join(directory, 'published') });
    for (const path of [directory, result.stagingRoot, result.publishedRoot]) {
      const info = await lstat(path); expect(info.isDirectory()).toBe(true); expect(info.mode & 0o777).toBe(0o700);
    }
    await writeFile(join(result.publishedRoot, 'preserved'), 'owned data', { mode: 0o600 });
    expect(await initializeInputRoots(directory)).toEqual(result);
    expect(await readFile(join(result.publishedRoot, 'preserved'), 'utf8')).toBe('owned data');
  });
  it.each(['inputs', 'staging', 'published'])('rejects a symlink at %s without modifying its destination', async name => {
    const directory = join(root, 'inputs'); const destination = join(root, 'destination');
    await mkdir(destination, { mode: 0o700 }); await writeFile(join(destination, 'preserved'), 'sentinel');
    if (name !== 'inputs') await mkdir(directory, { mode: 0o700 });
    const path = name === 'inputs' ? directory : join(directory, name);
    await symlink(destination, path);
    await expect(initializeInputRoots(directory)).rejects.toBeInstanceOf(InputDirectoryError);
    expect((await lstat(path)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(destination, 'preserved'), 'utf8')).toBe('sentinel');
  });
  it.each([0o755, 0o770, 0o1700])('rejects a non-private directory mode %s', async mode => {
    const directory = join(root, 'inputs'); await mkdir(directory, { mode: 0o700 }); await chmod(directory, mode);
    await expect(initializeInputRoots(directory)).rejects.toBeInstanceOf(InputDirectoryError);
    expect((await lstat(directory)).mode & 0o7777).toBe(mode);
  });
  it('rejects a regular file and preserves its bytes', async () => {
    const directory = join(root, 'inputs'); await writeFile(directory, 'keep', { mode: 0o600 });
    await expect(initializeInputRoots(directory)).rejects.toBeInstanceOf(InputDirectoryError);
    expect(await readFile(directory, 'utf8')).toBe('keep');
  });
  it('rejects an unsafe parent and unnormalized or relative configuration', async () => {
    await chmod(root, 0o755);
    await expect(initializeInputRoots(join(root, 'inputs'))).rejects.toBeInstanceOf(InputDirectoryError);
    await chmod(root, 0o700);
    for (const path of ['relative', `${root}/child/../inputs`, `${root}/inputs/`]) {
      await expect(initializeInputRoots(path)).rejects.toBeInstanceOf(InputDirectoryError);
    }
  });
});
