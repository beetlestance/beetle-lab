import type * as FilePromises from 'node:fs/promises';
import { chmod, link, mkdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { readK6Summary } from '../../wrapper/collection/index.js';
import { fixture } from './fixtures.js';

const hooks = vi.hoisted(() => ({ open: undefined as undefined | (() => Promise<void>),
  read: undefined as undefined | (() => Promise<void>), close: undefined as undefined | (() => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof FilePromises>();
  return { ...original, open: async (...args: Parameters<typeof original.open>) => {
    await hooks.open?.(); const handle = await original.open(...args);
    return { stat: () => handle.stat(), read: async (...parameters: [Uint8Array, number, number, number]) => {
      await hooks.read?.(); return handle.read(...parameters);
    }, close: async () => { try { await hooks.close?.(); } finally { await handle.close(); } } };
  } };
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('post-stop custody and lifecycle', () => {
  it.each(['spawned', 'state', 'groupAbsent', 'stdioClosed', 'quiescent'])('refuses %s before file IO', async field => {
    const f = await fixture(); let opens = 0; hooks.open = async () => { opens++; };
    try {
      const observation = { ...f.options.process, [field]: field === 'state' ? 'unknown' : false };
      const op = readK6Summary({ ...f.options, process: observation });
      expect(await op.result).toMatchObject({ ok: false, code: 'process' }); await op.quiesced; expect(opens).toBe(0);
    } finally { hooks.open = undefined; await f.dispose(); }
  });
  it.each(['uid', 'directory', 'symlink', 'hardlink', 'permissions', 'parent', 'fifo'])('refuses %s without blocking', async kind => {
    const f = await fixture();
    try {
      if (kind === 'directory') { await unlink(f.path); await mkdir(f.path); }
      if (kind === 'symlink') { await unlink(f.path); await symlink('absent', f.path); }
      if (kind === 'hardlink') await link(f.path, f.path + '.linked');
      if (kind === 'permissions') await chmod(f.path, 0o666);
      if (kind === 'parent') await chmod(f.options.outputDirectory, 0o755);
      if (kind === 'fifo') { await unlink(f.path); execFileSync('/usr/bin/mkfifo', [f.path]); }
      const op = readK6Summary({ ...f.options, uid: kind === 'uid' ? f.options.uid + 1 : f.options.uid });
      expect(await op.result).toMatchObject({ ok: false }); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it.each(['open', 'read', 'close'] as const)('retains late %s ownership after cancellation', async phase => {
    const f = await fixture(); const gate = deferred(); const entered = deferred(); const controller = new AbortController();
    hooks[phase] = async () => { entered.resolve(); await gate.promise; };
    try {
      const op = readK6Summary({ ...f.options, signal: controller.signal });
      await entered.promise; controller.abort();
      expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' });
      let quiet = false; void op.quiesced.then(() => { quiet = true; });
      await Promise.resolve(); expect(quiet).toBe(false);
      const closing = op.close(); gate.resolve(); await closing; expect(quiet).toBe(true);
    } finally { gate.resolve(); hooks[phase] = undefined; await f.dispose(); }
  });
  it('retains original close failure and rejected quiescence', async () => {
    const f = await fixture();
    // Close the actual FD first, then report a failed original-close outcome.
    hooks.close = async () => { throw new Error('private-canary'); };
    try {
      const op = readK6Summary(f.options);
      expect(await op.result).toEqual({ ok: false, code: 'filesystem', closeFailed: true });
      await expect(op.quiesced).rejects.toThrow('filesystem'); await expect(op.close()).rejects.toThrow('filesystem');
    } finally { hooks.close = undefined; await f.dispose(); }
  });
  it('fences failed validation on deadline and clock rollback', async () => {
    const f = await fixture(); let now = 100;
    try {
      await writeFile(f.path, '{}'); hooks.close = async () => { now = 99; };
      let op = readK6Summary({ ...f.options, deadlineMs: 1000, wallNow: () => now });
      expect(await op.result).toMatchObject({ ok: false, code: 'clock' }); await op.quiesced;
      now = 100; hooks.close = async () => { now = 1000; };
      op = readK6Summary({ ...f.options, deadlineMs: 1000, wallNow: () => now });
      expect(await op.result).toMatchObject({ ok: false, code: 'deadline' }); await op.quiesced;
    } finally { hooks.close = undefined; await f.dispose(); }
  });
  it('fences synchronous clock reentry and repeated close', async () => {
    const f = await fixture(); let op: ReturnType<typeof readK6Summary> | undefined;
    try {
      op = readK6Summary({ ...f.options, wallNow: () => { void op?.close(); return Date.now(); } });
      expect(await op.result).toMatchObject({ ok: false, code: 'closed' });
      expect(op.close()).toBe(op.close()); await op.quiesced;
    } finally { await f.dispose(); }
  });
  it('detects same-size mutation and growth between bounded read passes', async () => {
    const f = await fixture(); let reads = 0;
    try {
      hooks.read = async () => { if (++reads === 3) await writeFile(f.path, f.raw.replace('"avg":3', '"avg":4')); };
      const op = readK6Summary(f.options); expect(await op.result).toMatchObject({ ok: false, code: 'integrity' }); await op.quiesced;
    } finally { hooks.read = undefined; await f.dispose(); }
  });
  it('times out pending IO without declaring quiescence', async () => {
    const f = await fixture(); const gate = deferred(); const entered = deferred();
    hooks.read = async () => { entered.resolve(); await gate.promise; };
    try {
      const op = readK6Summary({ ...f.options, timeoutMs: 20 });
      await entered.promise;
      expect(await op.result).toMatchObject({ ok: false, code: 'deadline' });
      let quiet = false; void op.quiesced.then(() => { quiet = true; });
      await Promise.resolve(); expect(quiet).toBe(false); gate.resolve(); await op.quiesced;
    } finally { gate.resolve(); hooks.read = undefined; await f.dispose(); }
  });
  it('keeps late original-close failure explicit after cancellation', async () => {
    const f = await fixture(); const gate = deferred(); const entered = deferred(); const controller = new AbortController();
    hooks.close = async () => { entered.resolve(); await gate.promise; throw new Error('private-close'); };
    try {
      const op = readK6Summary({ ...f.options, signal: controller.signal });
      await entered.promise; controller.abort();
      expect(await op.result).toMatchObject({ ok: false, code: 'cancelled' });
      gate.resolve(); await expect(op.quiesced).rejects.toThrow('filesystem');
      await expect(op.close()).rejects.toThrow('filesystem');
    } finally { gate.resolve(); hooks.close = undefined; await f.dispose(); }
  });
  it('rejects growth past the descriptor snapshot', async () => {
    const f = await fixture(); let reads = 0;
    try {
      hooks.read = async () => { if (++reads === 2) await writeFile(f.path, f.raw + ' '); };
      const op = readK6Summary(f.options);
      expect(await op.result).toMatchObject({ ok: false, code: 'integrity' }); await op.quiesced;
    } finally { hooks.read = undefined; await f.dispose(); }
  });
  it.each(['deadline', 'rollback', 'cancelled'])('preserves original close failure with final %s callback', async kind => {
    const f = await fixture(); let now = 100; const controller = new AbortController();
    hooks.close = async () => { throw new Error('private-original-close'); };
    try {
      const op = readK6Summary({ ...f.options, deadlineMs: 1000, wallNow: () => now, signal: controller.signal });
      void op.quiesced.catch(() => {
        if (kind === 'cancelled') controller.abort();
        else now = kind === 'deadline' ? 1000 : 99;
      });
      expect(await op.result).toEqual({ ok: false, code: kind === 'cancelled' ? 'cancelled' : 'filesystem', closeFailed: true });
      await expect(op.quiesced).rejects.toThrow('filesystem'); await expect(op.close()).rejects.toThrow('filesystem');
    } finally { hooks.close = undefined; await f.dispose(); }
  });
  it('retains captured references when read callbacks replace live options', async () => {
    const f = await fixture();
    const options = { ...f.options };
    hooks.read = async () => {
      options.process = Object.freeze({ ...f.options.process, collection: 'complete' });
      options.outputDirectory += '/missing'; options.uid++; options.deadlineMs = 1;
    };
    try {
      const op = readK6Summary(options);
      expect(await op.result).toMatchObject({ ok: true, evidence: { nativeCollection: 'partial' } }); await op.quiesced;
    } finally { hooks.read = undefined; await f.dispose(); }
  });
});
