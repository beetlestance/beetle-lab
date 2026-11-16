import { describe, expect, it } from 'vitest';
import { mkdir, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Reader } from '../../src/collection/control/reader.js';
import { fixture, tracking, deferred } from './fixture.js';

describe('canonical root custody', () => {
  const f = fixture();
  it.each(['ancestor', 'root', 'file'])('rejects a %s symlink alias before publishing any data', async kind => {
    await f.write(`${JSON.stringify(f.event())}\n`); let directory = f.directory(); const t = tracking();
    if (kind === 'ancestor') {
      await mkdir(join(directory, 'real')); await mkdir(join(directory, 'real/job'), { mode: 0o700 });
      await rename(f.path(), join(directory, 'real/job/control.ndjson'));
      await symlink(join(directory, 'real'), join(directory, 'alias'));
      directory = join(directory, 'alias/job');
    }
    if (kind === 'root') { await symlink(directory, join(directory, 'alias')); directory = join(directory, 'alias'); }
    if (kind === 'file') { await rename(f.path(), `${f.path()}.real`); await symlink(`${f.path()}.real`, f.path()); }
    const reader = new Reader({ directory, uid: process.getuid!(), key: f.key(), checkpoint: null }, t.ports);
    try {
      const operation = reader.read({ deadline: performance.now() + 5000, stopped: false });
      expect(await operation.result).toEqual({ ok: false, reason: 'custody' }); await operation.quiesced;
    } finally { await reader.close(); }
    expect(t.opens()).toBe(kind === 'file' ? 1 : 0); expect(t.closes()).toBe(t.opens());
  });
  it.each(['cancelled', 'deadline', 'closed'])('owns pending realpath after public %s', async reason => {
    const t = tracking(); const issued = deferred<void>(); const release = deferred<void>();
    const reader = f.reader(null, { ...t.ports, realpath: new Proxy(t.ports.realpath, {
      apply: async (target, receiver, args) => {
        issued.resolve(); await release.promise; return Reflect.apply(target, receiver, args);
      },
    }) });
    const controller = new AbortController();
    const operation = reader.read({ deadline: performance.now() + (reason === 'deadline' ? 25 : 5000),
      stopped: false, signal: controller.signal });
    await issued.promise; let quiet = false; void operation.quiesced.then(() => { quiet = true; });
    if (reason === 'cancelled') controller.abort();
    let closing: Promise<void> | undefined;
    if (reason === 'closed') closing = reader.close();
    expect(await operation.result).toEqual({ ok: false, reason }); closing ??= reader.close();
    await Promise.resolve(); expect(quiet).toBe(false); expect(t.opens()).toBe(0);
    release.resolve(); await operation.quiesced; await closing;
    expect(t.opens()).toBe(0); expect(reader.close()).toBe(closing);
  });
  it('rechecks canonical custody after an admitted parent becomes a symlink alias', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const directory = join(f.directory(), 'job');
    await mkdir(directory, { mode: 0o700 }); await rename(f.path(), join(directory, 'control.ndjson'));
    const t = tracking(); const ports = { ...t.ports, open: async (...args: Parameters<typeof t.ports.open>) => {
      const handle = await t.ports.open(...args);
      if (String(args[0]) === directory) { await rename(directory, `${directory}.real`); await symlink(`${directory}.real`, directory); }
      return handle;
    } };
    const reader = new Reader({ directory, uid: process.getuid!(), key: f.key(), checkpoint: null }, ports);
    try {
      const operation = reader.read({ deadline: performance.now() + 5000, stopped: false });
      expect(await operation.result).toEqual({ ok: false, reason: 'custody' }); await operation.quiesced;
    } finally { await reader.close(); }
    expect(t.opens()).toBe(1); expect(t.closes()).toBe(1); expect(t.reads).toHaveLength(0);
  });
});
