import { describe, expect, it } from 'vitest';
import { chmod, link, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, tracking } from './fixture.js';

describe('declared path and filesystem custody', () => {
  const f = fixture();
  it.each(['reserved-result', 'reserved-control', 'duplicate-id', 'case-id', 'duplicate-path', 'case-path', 'ancestor'])(
  'rejects %s aliases before filesystem admission', async fault => {
    const artifact = await f.artifact('item.bin', 'data'); let artifacts = [artifact];
    if (fault === 'reserved-result') artifact.relativePath = 'ENGINE-RESULT.JSON';
    if (fault === 'reserved-control') artifact.relativePath = 'control.ndjson/child';
    if (fault === 'duplicate-id') artifacts.push({ ...artifact, relativePath: 'other.bin' });
    if (fault === 'case-id') {
      artifact.artifactId = 'abcdefab-1234-4000-8000-000000000001';
      artifacts.push({ ...artifact, artifactId: artifact.artifactId.toUpperCase(), relativePath: 'other.bin' });
    }
    if (fault === 'duplicate-path') artifacts.push({ ...artifact, artifactId: '00000000-0000-4000-8000-000000000099' });
    if (fault === 'case-path') artifacts.push({ ...artifact, artifactId: '00000000-0000-4000-8000-000000000099', relativePath: 'ITEM.BIN' });
    if (fault === 'ancestor') artifacts = [artifact, { ...artifact, artifactId: '00000000-0000-4000-8000-000000000099', relativePath: 'item.bin/child' }];
    const result = f.result(artifacts); await f.write(result); const t = tracking();
    expect(await f.collect(f.options(result), t.ports).result).toEqual({ ok: false, reason: 'custody' }); expect(t.opened).toHaveLength(0);
  });
  it.each(['../outside', 'a//b', 'a/./b', 'a/../b', 'é.bin', '/absolute'])('rejects ambiguous path %s', async path => {
    const artifact = await f.artifact('item.bin', 'data'); const result = structuredClone(f.result([artifact]));
    result.artifacts[0]!.relativePath = path; await f.write(result);
    expect(await f.collect(f.options(result)).result).toEqual({ ok: false, reason: 'result' });
  });
  it.each(['root-mode', 'parent-mode', 'file-mode', 'owner', 'hardlink', 'file-symlink', 'parent-symlink'])(
  'rejects %s custody', async fault => {
    const artifact = await f.artifact('reports/item.bin', 'data'); const result = f.result([artifact]); await f.write(result);
    if (fault === 'root-mode') await chmod(f.directory(), 0o750);
    if (fault === 'parent-mode') await chmod(f.path('reports'), 0o755);
    if (fault === 'file-mode') await chmod(f.path('reports/item.bin'), 0o644);
    if (fault === 'hardlink') await link(f.path('reports/item.bin'), f.path('alias'));
    if (fault === 'file-symlink') {
      await rename(f.path('reports/item.bin'), f.path('item.real')); await symlink(f.path('item.real'), f.path('reports/item.bin'));
    }
    if (fault === 'parent-symlink') { await rename(f.path('reports'), f.path('real')); await symlink(f.path('real'), f.path('reports')); }
    const t = tracking(); const options = f.options(result, fault === 'owner' ? { uid: process.getuid!() + 1 } : {});
    expect(await f.collect(options, t.ports).result).toEqual({ ok: false, reason: 'custody' }); expect(t.closed.length).toBe(t.opened.length);
  });
  it('rejects an ancestor alias even when the final root itself is a regular directory', async () => {
    const result = f.result(); await mkdir(f.path('real/job'), { recursive: true, mode: 0o700 });
    await writeFile(f.path('real/job/engine-result.json'), JSON.stringify(result), { mode: 0o600 });
    await symlink(f.path('real'), f.path('alias')); const t = tracking();
    const operation = f.collect(f.options(result, { directory: join(f.directory(), 'alias/job') }), t.ports);
    expect(await operation.result).toEqual({ ok: false, reason: 'custody' }); expect(t.opened).toHaveLength(0);
  });
  it('checks every earlier file again after artifacts have closed', async () => {
    const artifact = await f.artifact('item.bin', 'data'); const result = f.result([artifact]); await f.write(result);
    const t = tracking({ closeDone: async path => { if (path.endsWith('item.bin')) await writeFile(f.path(), JSON.stringify(result)); } });
    expect(await f.collect(f.options(result), t.ports).result).toEqual({ ok: false, reason: 'custody' });
    expect(t.closed.length).toBe(t.opened.length);
  });
});
