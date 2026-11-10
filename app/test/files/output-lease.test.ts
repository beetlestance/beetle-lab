import { chmod, copyFile, link, lstat, mkdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { nativePort } from '../../src/adapters/outbound/files/custody/index.js';
import { openOutputLease } from '../../src/adapters/outbound/files/outputs/lease.js';
import { fixture } from './output-lease-fixture.js';

const f = fixture();
it('holds real cross-process exclusion and rejects duplicates before probing the locked inode', async () => {
  const owner = await f.open(); await owner.check();
  const probe = vi.spyOn(nativePort, 'lstat'); const opens = vi.spyOn(nativePort, 'open');
  try {
    await expect(f.open(false)).rejects.toMatchObject({ code: 'owned' });
    expect(probe).not.toHaveBeenCalled(); expect(opens).not.toHaveBeenCalled();
  } finally { probe.mockRestore(); opens.mockRestore(); }
  const contender = f.child('try'); expect(await contender.ready).toEqual({ kind: 'refused', code: 'owned' }); await contender.exit;
  const closing = owner.close(); expect(owner.close()).toBe(closing);
  await expect(owner.check()).rejects.toMatchObject({ code: 'closed' }); await closing;
  const recovered = await f.open(false); await recovered.check();
});
it('releases on confirmed SIGKILL and recovers the exact existing inode', async () => {
  const initial = await f.open(); await initial.close(); const original = await lstat(f.path(), { bigint: true });
  const active = f.child('hold'); expect(await active.ready).toEqual({ kind: 'ready' });
  const contender = f.child('try'); expect(await contender.ready).toEqual({ kind: 'refused', code: 'owned' }); await contender.exit;
  await f.kill(active.child); expect(active.child.signalCode).toBe('SIGKILL');
  const recovered = await f.open(false); await recovered.check();
  const current = await lstat(f.path(), { bigint: true }); expect(current.ino).toBe(original.ino); expect(current.dev).toBe(original.dev);
});
it.each(['missing', 'replacement', 'symlink', 'hardlink', 'mode'] as const)('fences a held %s sidecar without reacquiring', async kind => {
  const owner = await f.open(); const extra = join(f.root(), 'other');
  if (kind === 'missing') await unlink(f.path());
  if (kind === 'replacement') { await copyFile(f.path(), extra); await rename(extra, f.path()); }
  if (kind === 'symlink') { await rename(f.path(), extra); await symlink(extra, f.path()); }
  if (kind === 'hardlink') await link(f.path(), extra);
  if (kind === 'mode') await chmod(f.path(), 0o644);
  await expect(owner.check()).rejects.toMatchObject({ code: 'integrity', message: 'Output namespace lease failed' });
  await expect(owner.check()).rejects.toMatchObject({ code: 'closed' });
  await expect(f.open(false)).rejects.toMatchObject({ code: 'owned' });
});
it.each(['missing', 'symlink', 'hardlink', 'mode', 'corrupt', 'oversize'] as const)('refuses %s recovery without recreation', async kind => {
  const initial = await f.open(); await initial.close(); const extra = join(f.root(), 'other');
  if (kind === 'missing') await unlink(f.path());
  if (kind === 'symlink') { await rename(f.path(), extra); await symlink(extra, f.path()); }
  if (kind === 'hardlink') await link(f.path(), extra);
  if (kind === 'mode') await chmod(f.path(), 0o644);
  if (kind === 'corrupt') await writeFile(f.path(), 'invalid sqlite');
  if (kind === 'oversize') await writeFile(f.path(), Buffer.alloc(65_537));
  await expect(f.open(false)).rejects.toMatchObject({ code: 'integrity' });
  if (kind === 'missing') await expect(lstat(f.path())).rejects.toMatchObject({ code: 'ENOENT' });
});
it('drains an issued named check before releasing the SQLite lock', async () => {
  const owner = await f.open(); let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); const start = new Promise<void>(resolve => { entered = resolve; });
  const original = nativePort.lstat; let held = 0;
  const probe = vi.spyOn(nativePort, 'lstat').mockImplementation(async (...args) => {
    if (held < 2) { held++; if (held === 2) entered(); await gate; } return original(...args);
  });
  const checks = [owner.check(), owner.check()]; await start;
  await expect(owner.check()).rejects.toMatchObject({ code: 'owned' }); const close = owner.close(); let closed = false; void close.then(() => { closed = true; });
  try {
    const contender = f.child('try'); expect(await contender.ready).toEqual({ kind: 'refused', code: 'owned' }); await contender.exit;
    expect(closed).toBe(false); await expect(owner.check()).rejects.toMatchObject({ code: 'closed' });
  } finally { release(); probe.mockRestore(); await Promise.all(checks); await close; }
});
it('requires explicit exclusive creation and canonical paths', async () => {
  const owner = await f.open(); await owner.close();
  await expect(f.open()).rejects.toMatchObject({ code: 'io' });
  await expect(openOutputLease({ path: `${f.root()}/../invalid`, create: false })).rejects.toMatchObject({ code: 'invalid_input' });
});

it('retains the native lock and cached registry fence after an uncertain SQLite close', async () => {
  const initial = await f.open(); await initial.close();
  const active = f.child('sticky');
  expect(await active.ready).toEqual({ kind: 'sticky', code: 'cleanup', duplicate: 'owned', calls: 1, cached: true });
  const contender = f.child('try'); expect(await contender.ready).toEqual({ kind: 'refused', code: 'owned' }); await contender.exit;
  await f.kill(active.child);
  const recovered = await f.open(false); await recovered.check();
});

it.each(['replacement', 'symlink', 'mode'] as const)('fences %s of the pinned private parent', async kind => {
  const owner = await f.open(); const moved = `${f.root()}-original`;
  try {
    if (kind === 'mode') await chmod(f.root(), 0o755);
    else {
      await rename(f.root(), moved);
      if (kind === 'replacement') await mkdir(f.root(), { mode: 0o700 });
      else await symlink(moved, f.root());
    }
    await expect(owner.check()).rejects.toMatchObject({ code: 'integrity' });
    await expect(f.open(false)).rejects.toMatchObject({ code: 'owned' });
  } finally {
    if (kind === 'mode') await chmod(f.root(), 0o700);
    else { await rm(f.root(), { recursive: true }); await rename(moved, f.root()); }
  }
});

it('reserves ownership before invoking caller property access', async () => {
  let duplicate: Promise<unknown> | undefined;
  const owner = await openOutputLease({ get path() { duplicate = expect(f.open(false)).rejects.toMatchObject({ code: 'owned' }); return f.path(); }, create: true });
  try { await duplicate; await owner.check(); } finally { await owner.close(); }
});
