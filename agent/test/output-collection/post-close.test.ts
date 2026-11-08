import { describe, expect, it } from 'vitest';
import { chmod, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { fixture, tracking, deferred, sha } from './fixture.js';
import type { OutputPorts } from '../../src/collection/output/ports.js';

describe('custody after original descriptor closes', () => {
  const f = fixture();
  it.each(['artifact', 'result', 'root-mode', 'path'])('rejects %s mutation while original root close is pending', async fault => {
    const artifact = await f.artifact('item.bin', 'good'); const result = f.result([artifact]); await f.write(result);
    const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ close: async path => { if (path === f.directory()) { issued.resolve(); await release.promise; } } });
    const operation = f.collect(f.options(result), t.ports); await issued.promise;
    if (fault === 'artifact') { await writeFile(f.path('item.bin'), 'FAKE'); expect(sha('FAKE')).not.toBe(artifact.sha256); }
    if (fault === 'result') await writeFile(f.path(), JSON.stringify(result).replace('"outcome":"passed"', '"outcome":"failed"'));
    if (fault === 'root-mode') await chmod(f.directory(), 0o705);
    if (fault === 'path') { await rename(f.path('item.bin'), f.path('original.bin')); await symlink(f.path('original.bin'), f.path('item.bin')); }
    release.resolve(); expect(await operation.result).toEqual({ ok: false, reason: 'custody' }); await operation.quiesced;
    await operation.close(); expect(t.closed.length).toBe(t.opened.length); expect(new Set(t.closed).size).toBe(t.closed.length);
  });
  it('rejects replacement of the canonical root by a symlink while its descriptor closes', async () => {
    await mkdir(f.path('job'), { mode: 0o700 }); const artifact = await f.artifact('job/item.bin', 'good'); artifact.relativePath = 'item.bin';
    const result = f.result([artifact]); await f.write(result); await rename(f.path(), f.path('job/engine-result.json'));
    const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ close: async path => { if (path === f.path('job')) { issued.resolve(); await release.promise; } } });
    const operation = f.collect(f.options(result, { directory: f.path('job') }), t.ports); await issued.promise;
    await rename(f.path('job'), f.path('original')); await symlink(f.path('original'), f.path('job')); release.resolve();
    expect(await operation.result).toEqual({ ok: false, reason: 'custody' }); await operation.quiesced;
    expect(t.closed.length).toBe(t.opened.length);
  });
  function stalledMetadata() {
    let rootClosed = false; let stalled = false; let calls = 0;
    const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ closeDone: path => { if (path === f.directory()) rootClosed = true; } });
    const ports: OutputPorts = { ...t.ports, lstat: new Proxy(t.ports.lstat, {
      apply: async (target, receiver, args) => {
        if (rootClosed) {
          calls++;
          if (!stalled) { stalled = true; issued.resolve(); await release.promise; }
        }
        return Reflect.apply(target, receiver, args);
      },
    }) };
    return { t, ports, issued, release, calls: () => calls };
  }
  it.each(['cancelled', 'deadline'])('retains both slots and original post-close metadata through %s', async reason => {
    const result = f.result(); await f.write(result); const a = stalledMetadata(); const b = stalledMetadata();
    const controller = new AbortController();
    const options = f.options(result, { signal: controller.signal, deadline: performance.now() + (reason === 'deadline' ? 200 : 5000) });
    const first = f.collect(options, a.ports); const second = f.collect(options, b.ports);
    await Promise.all([a.issued.promise, b.issued.promise]);
    expect(a.t.closed.length).toBe(a.t.opened.length); expect(b.t.closed.length).toBe(b.t.opened.length);
    if (reason === 'cancelled') controller.abort();
    expect(await first.result).toEqual({ ok: false, reason }); expect(await second.result).toEqual({ ok: false, reason });
    expect(await f.collect(f.options(result)).result).toEqual({ ok: false, reason: 'busy' });
    let quiet = false; void first.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    const closing = first.close(); expect(first.close()).toBe(closing); let closed = false; void closing.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); a.release.resolve(); b.release.resolve();
    await Promise.all([first.quiesced, second.quiesced, closing, second.close()]);
    expect(a.calls()).toBe(1); expect(b.calls()).toBe(1);
    expect(await f.collect(f.options(result)).result).toMatchObject({ ok: true });
  });
  it('checks untouched paths after cleanup without reopening or statting closed descriptors', async () => {
    const artifact = await f.artifact('item.bin', 'good'); const result = f.result([artifact]); await f.write(result);
    const t = tracking(); let postCloseChecks = 0; let closedStats = 0;
    const ports: OutputPorts = { ...t.ports,
      lstat: new Proxy(t.ports.lstat, { apply: async (target, receiver, args) => {
        if (t.opened.length > 0 && t.closed.length === t.opened.length) postCloseChecks++;
        return Reflect.apply(target, receiver, args);
      } }),
      open: async (...args) => {
        const handle = await t.ports.open(...args); let closed = false;
        return new Proxy(handle, { get(target, property) {
          if (property === 'stat') return (...values: unknown[]) => {
            if (closed) { closedStats++; throw new Error('stat of a closed descriptor'); }
            return Reflect.apply(target.stat, target, values);
          };
          if (property === 'close') return async () => { closed = true; await target.close(); };
          const value: unknown = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
        } });
      },
    };
    const operation = f.collect(f.options(result), ports);
    expect(await operation.result).toMatchObject({ ok: true }); await operation.quiesced;
    expect(postCloseChecks).toBe(3); expect(closedStats).toBe(0);
    expect(t.opened).toHaveLength(3); expect(t.closed).toHaveLength(3); expect(new Set(t.closed).size).toBe(3);
    await operation.close(); expect(t.closed).toHaveLength(3);
  });
});
