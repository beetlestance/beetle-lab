import { describe, expect, it } from 'vitest';
import { chmod, link, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { rangeFixture, tracking, deferred } from './fixture.js';

describe('stored root and per-operation native range custody', () => {
  const f = rangeFixture();
  it.each(['directory', 'uid', 'device', 'inode', 'modifiedNs', 'changedNs'] as const)('pins stored %s before payload reads', async field => {
    const artifact = await f.artifact('data.bin', 'body'); const options = await f.rangeOptions(artifact); const t = tracking();
    const root = { ...options.root, [field]: field === 'uid' ? options.root.uid + 1 : field === 'directory' ? `${f.directory()}/absent` : '0' };
    const result = await f.range({ ...options, root }, t.ports).result;
    expect(result).toEqual({ ok: false, reason: field === 'directory' ? 'missing' : 'custody' });
    expect(t.reads).toHaveLength(0); expect(t.closed.length).toBe(t.opened.filter(path => field !== 'directory' || path !== root.directory).length);
  });
  it('rejects a replaced native root even at EOF', async () => {
    await mkdir(f.path('job'), { mode: 0o700 });
    const artifact = await f.artifact('job/data.bin', 'body'); artifact.relativePath = 'data.bin';
    const options = await f.rangeOptions(artifact); const t = tracking();
    const { lstat } = await import('node:fs/promises'); const stat = await lstat(f.path('job'), { bigint: true });
    const root = { ...options.root, directory: f.path('job'), device: stat.dev.toString(), inode: stat.ino.toString(),
      modifiedNs: stat.mtimeNs.toString(), changedNs: stat.ctimeNs.toString() };
    await rename(f.path('job'), f.path('old')); await mkdir(f.path('job'), { mode: 0o700 });
    await writeFile(f.path('job/data.bin'), 'FAKE', { mode: 0o600 });
    expect(await f.range({ ...options, root, offset: 4 }, t.ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.reads).toHaveLength(0);
  });
  it.each(['root-mode', 'parent-mode', 'file-mode', 'hardlink', 'file-symlink', 'parent-symlink'])(
    'rejects %s with native descriptors', async fault => {
      const artifact = await f.artifact('reports/data.bin', 'body');
      if (fault === 'root-mode') await chmod(f.directory(), 0o750);
      if (fault === 'parent-mode') await chmod(f.path('reports'), 0o755);
      if (fault === 'file-mode') await chmod(f.path('reports/data.bin'), 0o644);
      if (fault === 'hardlink') await link(f.path('reports/data.bin'), f.path('reports/alias'));
      if (fault === 'file-symlink') {
        await rename(f.path('reports/data.bin'), f.path('reports/real')); await symlink(f.path('reports/real'), f.path('reports/data.bin'));
      }
      if (fault === 'parent-symlink') { await rename(f.path('reports'), f.path('real')); await symlink(f.path('real'), f.path('reports')); }
      const t = tracking();
      expect(await f.range(await f.rangeOptions(artifact), t.ports).result).toEqual({ ok: false, reason: 'custody' });
      expect(t.reads).toHaveLength(0);
    });
  it.each(['file', 'ancestor', 'content'])('rejects %s mutation after an original read', async fault => {
    const artifact = await f.artifact('reports/data.bin', 'body');
    const t = tracking({ readDone: async () => {
      if (fault === 'content') await writeFile(f.path('reports/data.bin'), 'EDIT');
      if (fault === 'file') {
        await rename(f.path('reports/data.bin'), f.path('reports/old'));
        await writeFile(f.path('reports/data.bin'), 'body', { mode: 0o600 });
      }
      if (fault === 'ancestor') {
        await rename(f.path('reports'), f.path('original')); await mkdir(f.path('reports'), { mode: 0o700 });
        await writeFile(f.path('reports/data.bin'), 'body', { mode: 0o600 });
      }
    } });
    expect(await f.range(await f.rangeOptions(artifact), t.ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.closed.length).toBe(t.opened.length);
  });
  it.each(['file', 'root', 'ancestor', 'parent-symlink'])('withholds success and rejects %s mutation around original close', async fault => {
    const artifact = await f.artifact('reports/data.bin', 'body');
    const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ close: async path => { if (path === f.directory()) { issued.resolve(); await release.promise; } } });
    const operation = f.range(await f.rangeOptions(artifact), t.ports); let replied = false;
    void operation.result.then(() => { replied = true; }); await issued.promise; expect(replied).toBe(false);
    if (fault === 'file') await writeFile(f.path('reports/data.bin'), 'EDIT');
    if (fault === 'root') await chmod(f.directory(), 0o705);
    if (fault === 'ancestor') { await rename(f.path('reports'), f.path('old')); await mkdir(f.path('reports'), { mode: 0o700 }); }
    if (fault === 'parent-symlink') {
      await mkdir(f.path('other'), { mode: 0o700 });
      await rename(f.path('reports'), f.path('other/reports'));
      await symlink(f.path('other/reports'), f.path('reports'));
    }
    release.resolve(); expect(await operation.result).toEqual({ ok: false, reason: 'custody' });
    expect(t.closed.length).toBe(t.opened.length);
  });
  it('rejects file replacement between named stat and native open', async () => {
    const artifact = await f.artifact('reports/data.bin', 'body');
    const t = tracking({ open: async path => {
      if (!path.endsWith('data.bin')) return;
      await rm(path); await writeFile(path, 'body', { mode: 0o600 });
    } });
    expect(await f.range(await f.rangeOptions(artifact), t.ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.reads).toHaveLength(0); expect(t.closed.length).toBe(t.opened.length);
  });
});
