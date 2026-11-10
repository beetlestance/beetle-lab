import { describe, expect, it, vi } from 'vitest';
import type { BigIntStats } from 'node:fs';
import { chmod, lstat, mkdir, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { CONTROL_READ_MAX_MS } from '../../src/collection/control/types.js';
import type { ControlReader, ControlReadValue } from '../../src/collection/control/index.js';
import { nodePorts } from '../../src/collection/control/ports.js';
import type { ReaderPorts } from '../../src/collection/control/ports.js';
import { ack, deferred, fixture, value } from './fixture.js';

function stopped(value: ControlReadValue) {
  if (value.kind !== 'caught_up' || value.consistency !== 'stopped_verified') throw new Error('Expected stopped facts');
  return value;
}
async function accept(reader: ControlReader): Promise<void> {
  const batch = await value(reader);
  expect(batch).not.toHaveProperty('root');
  if (batch.kind !== 'batch') throw new Error('Expected batch');
  reader.accept(ack(batch.request));
}
function faultPorts(hooks: {
  readonly stat?: (stat: BigIntStats) => BigIntStats;
  readonly close?: (path: string) => Promise<void>;
  readonly closed?: (path: string) => void;
}) {
  const opened: string[] = []; const closed: string[] = []; let closedStats = 0;
  const ports: ReaderPorts = { ...nodePorts,
    lstat: new Proxy(nodePorts.lstat, { apply: async (target, receiver, args) => {
      const stat: BigIntStats = await Reflect.apply(target, receiver, args);
      return hooks.stat ? hooks.stat(stat) : stat;
    } }),
    open: async (...args) => {
      const handle = await nodePorts.open(...args); const path = String(args[0]); opened.push(path); let done = false;
      return new Proxy(handle, { get(target, property) {
        if (property === 'stat') return async (...values: unknown[]) => {
          if (done) { closedStats++; throw new Error('Stat after original close'); }
          const stat: BigIntStats = await Reflect.apply(target.stat, target, values);
          return hooks.stat ? hooks.stat(stat) : stat;
        };
        if (property === 'close') return async () => {
          await hooks.close?.(path); await target.close(); done = true; closed.push(path); hooks.closed?.(path);
        };
        const field: unknown = Reflect.get(target, property);
        return typeof field === 'function' ? field.bind(target) : field;
      } });
    },
  };
  return { ports, opened, closed, closedStats: () => closedStats };
}

describe('stopped control root facts', () => {
  const f = fixture();
  async function prepared(ports?: ReaderPorts): Promise<ControlReader> {
    await f.write(`${JSON.stringify(f.event())}\n`); const reader = f.reader(null, ports);
    await accept(reader); return reader;
  }
  it('captures current native directory facts after legitimate live creation, then retains the frozen snapshot', async () => {
    const reader = await prepared(); await utimes(f.directory(), 1, 1);
    const initial = await lstat(f.directory(), { bigint: true });
    expect(await value(reader)).toMatchObject({ consistency: 'live_provisional' });
    expect(await value(reader)).not.toHaveProperty('root');
    await writeFile(join(f.directory(), 'engine-result.json'), 'synthetic output', { mode: 0o600 });
    const current = await lstat(f.directory(), { bigint: true });
    expect(current.mtimeNs).not.toBe(initial.mtimeNs);
    const verified = stopped(await value(reader, true));
    expect(verified.root).toEqual({ directory: f.directory(), uid: process.getuid!(), device: current.dev.toString(),
      inode: current.ino.toString(), modifiedNs: current.mtimeNs.toString(), changedNs: current.ctimeNs.toString() });
    expect(Object.isFrozen(verified.root)).toBe(true);
    expect(Reflect.set(verified.root, 'inode', 'different')).toBe(false);
    expect(stopped(await value(reader, true)).root).toBe(verified.root);
    await reader.close();
  });
  it('never exposes root facts on missing-live, restart or bounded final-progress values', async () => {
    const missing = f.reader(); expect(await value(missing)).not.toHaveProperty('root'); await missing.close();
    const raw = Array.from({ length: 1500 }, (_, i) => `${JSON.stringify(f.event(i + 1))}\n`).join('');
    await f.write(raw); const stat = await lstat(f.path(), { bigint: true });
    const reader = f.reader({ version: 1, dev: stat.dev.toString(), ino: stat.ino.toString(), offset: Buffer.byteLength(raw),
      wrapperSeq: 1500, prefixSha256: createHash('sha256').update(raw).digest('hex'), lastBatchDigest: 'a'.repeat(64) });
    let progress = await value(reader); expect(progress).toMatchObject({ kind: 'verifying', phase: 'restart' });
    expect(progress).not.toHaveProperty('root');
    while (progress.kind === 'verifying' && progress.verifiedBytes < progress.targetBytes) {
      progress = await value(reader); expect(progress).not.toHaveProperty('root');
    }
    const final = await value(reader, true); expect(final).toMatchObject({ kind: 'verifying', phase: 'final' });
    expect(final).not.toHaveProperty('root');
    await writeFile(join(f.directory(), 'late-output'), 'mutation');
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result)
      .toEqual({ ok: false, reason: 'custody' });
    await expect(reader.close()).rejects.toMatchObject({ reason: 'custody' });
  });
  it.each([9_007_199_254_740_991n, 9_007_199_254_740_992n, 18_446_744_073_709_551_615n])(
    'preserves exact root bigint strings at %s and rejects adjacent changed metadata', async boundary => {
      let changed = boundary;
      const t = faultPorts({ stat: stat => {
        if (stat.isDirectory()) Object.defineProperties(stat, { dev: { value: boundary }, ino: { value: boundary },
          mtimeNs: { value: changed }, ctimeNs: { value: boundary } });
        return stat;
      } });
      const reader = await prepared(t.ports); const verified = stopped(await value(reader, true));
      expect(verified.root).toMatchObject({ device: boundary.toString(), inode: boundary.toString(),
        modifiedNs: boundary.toString(), changedNs: boundary.toString() });
      expect(Object.isFrozen(verified.root)).toBe(true); changed++;
      expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result)
        .toEqual({ ok: false, reason: 'custody' });
      await expect(reader.close()).rejects.toMatchObject({ reason: 'custody' });
      expect(t.closed).toHaveLength(2);
    });
  it.each(['missing', 'replacement', 'symlink', 'mode', 'metadata'])(
    'rejects %s of a pinned root on a cached stopped read', async fault => {
      const reader = await prepared(); const verified = stopped(await value(reader, true));
      const original = `${f.directory()}-original`;
      try {
        if (['missing', 'replacement', 'symlink'].includes(fault)) await rename(f.directory(), original);
        if (fault === 'replacement') await mkdir(f.directory(), { mode: 0o700 });
        if (fault === 'symlink') await symlink(original, f.directory());
        if (fault === 'mode') await chmod(f.directory(), 0o705);
        if (fault === 'metadata') await utimes(f.directory(), 1, 1);
        const result = await reader.read({ deadline: performance.now() + 5000, stopped: true }).result;
        expect(result).toEqual({ ok: false, reason: fault === 'missing' ? 'io' : 'custody' });
        await expect(reader.close()).rejects.toMatchObject({ reason: fault === 'missing' ? 'io' : 'custody' });
        expect(verified.root.directory).toBe(f.directory());
      } finally {
        if (['missing', 'replacement', 'symlink'].includes(fault)) {
          await rm(f.directory(), { recursive: true, force: true }); await rename(original, f.directory());
        }
      }
    });
  it('requires a present original root before final verification', async () => {
    const reader = await prepared(); const original = `${f.directory()}-original`;
    await rename(f.directory(), original);
    try {
      expect(await reader.read({ deadline: performance.now() + 5000, stopped: true }).result).toEqual({ ok: false, reason: 'io' });
      await reader.close();
    } finally { await rename(original, f.directory()); }
  });
  it.each(['file', 'root'])('retains a held original %s close and performs named checks only after both closes', async which => {
    const entered = deferred<void>(); const release = deferred<void>(); let postChecks = 0;
    const t = faultPorts({ close: async path => {
      if ((path === f.directory()) === (which === 'root')) { entered.resolve(); await release.promise; }
    } });
    const ports: ReaderPorts = { ...t.ports, lstat: new Proxy(t.ports.lstat, { apply: (target, receiver, args) => {
      if (t.closed.length === 2) postChecks++; return Reflect.apply(target, receiver, args);
    } }) };
    const reader = await prepared(ports); stopped(await value(reader, true));
    const closing = reader.close(); expect(reader.close()).toBe(closing);
    let settled = false; void closing.then(() => { settled = true; });
    try {
      await entered.promise; expect(settled).toBe(false); expect(postChecks).toBe(0);
      release.resolve(); await closing;
      expect(postChecks).toBe(1); expect(t.closed).toHaveLength(2); expect(t.closedStats()).toBe(0);
      await reader.close(); expect(postChecks).toBe(1); expect(t.opened).toHaveLength(2);
    } finally { release.resolve(); }
  });
  it.each(['mode', 'metadata', 'replacement', 'symlink', 'missing'])(
    'rejects post-close %s mutation during an original root close', async fault => {
      const entered = deferred<void>(); const release = deferred<void>();
      const t = faultPorts({ close: async path => { if (path === f.directory()) { entered.resolve(); await release.promise; } } });
      const reader = await prepared(t.ports); const verified = stopped(await value(reader, true));
      const original = `${f.directory()}-original`; const closing = reader.close();
      const rejection = expect(closing).rejects.toMatchObject({ reason: fault === 'missing' ? 'io' : 'custody' });
      try {
        await entered.promise;
        if (fault === 'mode') await chmod(f.directory(), 0o705);
        if (fault === 'metadata') await writeFile(join(f.directory(), 'late-output'), 'late');
        if (['replacement', 'symlink', 'missing'].includes(fault)) await rename(f.directory(), original);
        if (fault === 'replacement') await mkdir(f.directory(), { mode: 0o700 });
        if (fault === 'symlink') await symlink(original, f.directory());
        release.resolve(); await rejection; expect(reader.close()).toBe(closing);
        expect(Object.isFrozen(verified.root)).toBe(true); expect(t.closed).toHaveLength(2);
      } finally {
        release.resolve(); await Promise.allSettled([closing]);
        if (['replacement', 'symlink', 'missing'].includes(fault)) {
          await rm(f.directory(), { recursive: true, force: true }); await rename(original, f.directory());
        }
      }
    });
  it.each(['file', 'root'])('keeps a failed original %s close rejected without retrying', async which => {
    const t = faultPorts({ closed: path => {
      if ((path === f.directory()) === (which === 'root')) throw new Error('Synthetic original close failure');
    } });
    const reader = await prepared(t.ports); stopped(await value(reader, true));
    const closing = reader.close(); await expect(closing).rejects.toMatchObject({ reason: 'io' });
    expect(reader.close()).toBe(closing); await expect(reader.close()).rejects.toMatchObject({ reason: 'io' });
    expect(t.closed).toHaveLength(2); expect(t.closedStats()).toBe(0);
  });
  it.each(['success', 'deadline'])('owns held post-close named metadata through %s without reopening descriptors', async outcome => {
    const entered = deferred<void>(); const release = deferred<void>(); let checks = 0; let now = performance.now();
    const t = faultPorts({});
    const ports: ReaderPorts = { ...t.ports, now: () => now,
      lstat: new Proxy(t.ports.lstat, { apply: async (target, receiver, args) => {
        if (t.closed.length === 2) { checks++; entered.resolve(); await release.promise; }
        return Reflect.apply(target, receiver, args);
      } }),
    };
    const reader = await prepared(ports); stopped(await value(reader, true));
    const closing = reader.close(); const settled = closing.then(() => 'success', () => 'failure');
    let done = false; void settled.then(() => { done = true; });
    try {
      await entered.promise; expect(done).toBe(false); expect(t.closed).toHaveLength(2);
      if (outcome === 'deadline') now += CONTROL_READ_MAX_MS + 1;
      release.resolve();
      if (outcome === 'deadline') await expect(closing).rejects.toMatchObject({ reason: 'deadline' });
      else await closing;
      expect(checks).toBe(1); expect(t.opened).toHaveLength(2); expect(t.closedStats()).toBe(0);
      expect(reader.close()).toBe(closing);
    } finally { release.resolve(); await settled; }
  });
  it('retains post-close original metadata after the actual deadline timer settles its early result', async () => {
    const entered = deferred<void>(); const release = deferred<void>(); let checks = 0; let originalDone = false;
    const originalSettled = deferred<void>();
    const t = faultPorts({});
    const ports: ReaderPorts = { ...t.ports,
      lstat: new Proxy(t.ports.lstat, { apply: async (target, receiver, args) => {
        if (t.closed.length === 2) {
          checks++; entered.resolve(); await release.promise;
          try { return await Reflect.apply(target, receiver, args); }
          finally { originalDone = true; originalSettled.resolve(); }
        }
        return Reflect.apply(target, receiver, args);
      } }),
    };
    const reader = await prepared(ports); stopped(await value(reader, true));
    let closing: Promise<void> | undefined; let outcome = 'pending';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      closing = reader.close();
      void closing.then(() => { outcome = 'resolved'; }, () => { outcome = 'rejected'; });
      await entered.promise;
      expect(vi.getTimerCount()).toBe(1); expect(t.closed).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(CONTROL_READ_MAX_MS);
      expect(vi.getTimerCount()).toBe(0); expect(originalDone).toBe(false);
      expect(outcome).toBe('pending'); expect(reader.close()).toBe(closing);
      release.resolve();
      await expect(closing).rejects.toMatchObject({ reason: 'deadline' });
      expect(originalDone).toBe(true); expect(outcome).toBe('rejected');
      expect(reader.close()).toBe(closing);
      await expect(reader.close()).rejects.toMatchObject({ reason: 'deadline' });
      expect(checks).toBe(1); expect(t.opened).toHaveLength(2); expect(t.closedStats()).toBe(0);
    } finally {
      release.resolve();
      try { await Promise.allSettled([closing ?? reader.close(), originalSettled.promise]); }
      finally { vi.useRealTimers(); }
    }
  });
});
