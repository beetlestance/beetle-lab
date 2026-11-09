import { execFileSync } from 'node:child_process';
import { chmod, link, mkdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgentConfiguration } from '../../../src/bootstrap/agent-configuration.js';
import { fixture, installationId } from './fixture.js';

describe('private file rejection and redaction', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { f = await fixture(); });
  afterEach(async () => { await f.cleanup(); });
  async function rejected() {
    const error: unknown = await loadAgentConfiguration(f.path, installationId).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Agent configuration rejected');
    const text = JSON.stringify(error) + String(error);
    for (const privateValue of [f.root, f.path, f.tokenPath, 'private-detail']) expect(text).not.toContain(privateValue);
    expect(Object.hasOwn(error as Error, 'cause')).toBe(false);
  }
  it.each(['config', 'token'])('rejects oversized %s', async kind => {
    await writeFile(kind === 'config' ? f.path : f.tokenPath, Buffer.alloc(kind === 'config' ? 65_537 : 130, 120));
    await rejected();
  });
  it.each(['config', 'token'])('rejects malformed UTF8 %s', async kind => {
    await writeFile(kind === 'config' ? f.path : f.tokenPath, Buffer.from([0xc0, 0xaf])); await rejected();
  });
  it('accepts the exact 64KiB configuration ceiling', async () => {
    const raw = JSON.stringify(f.value); await writeFile(f.path, raw + ' '.repeat(65_536 - Buffer.byteLength(raw)));
    expect((await loadAgentConfiguration(f.path, installationId)).configuration).toEqual(f.value);
  });
  it.each([0o640, 0o604, 0o620, 0o601, 0o660, 0o644])('rejects private permission drift %i', async mode => {
    await chmod(f.path, mode); await rejected();
    await chmod(f.path, 0o600); await chmod(f.tokenPath, mode); await rejected();
  });
  it.each(['config', 'token'])('rejects a %s symlink', async kind => {
    const path = kind === 'config' ? f.path : f.tokenPath; const target = join(f.root, 'private-detail');
    await rename(path, target); await symlink(target, path); await rejected();
  });
  it.each(['config', 'token'])('rejects a %s hardlink', async kind => {
    await link(kind === 'config' ? f.path : f.tokenPath, join(f.root, 'private-detail')); await rejected();
  });
  it.each(['config', 'token'])('rejects a %s FIFO without blocking', async kind => {
    const path = kind === 'config' ? f.path : f.tokenPath;
    await unlink(path); execFileSync('mkfifo', ['-m', '600', path]); await rejected();
  });
  it.each(['config', 'token'])('rejects a %s directory', async kind => {
    const path = kind === 'config' ? f.path : f.tokenPath; await unlink(path); await mkdir(path, { mode: 0o700 }); await rejected();
  });
  it('rejects symlink ancestry even with a regular target', async () => {
    const alias = join(f.root, 'alias'); await symlink(f.root, alias);
    await f.write({ ...f.value, tokenFile: join(alias, 'token') }); await rejected();
  });
  it('redacts JSON parse, token validation and native filesystem details', async () => {
    await writeFile(f.path, '{"private-detail":'); await rejected();
    await f.write(); await writeFile(f.tokenPath, 'private-detail'); await rejected();
    await f.write({ ...f.value, tokenFile: join(f.root, 'private-detail') }); await rejected();
  });
});
