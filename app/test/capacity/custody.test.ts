import type { FileHandle } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { Capabilities, ClientResult } from '@beetle/contracts';
import type { BigIntStatsFs } from 'node:fs';
import { deferred, fixture } from './fixture.js';
import { nativeDisk } from '../../src/adapters/outbound/capacity/disk.js';

describe('capacity original native and cancellation custody', () => {
  it('allows one original gateway call, rejects saturation without I/O and drains on close', async () => {
    const f = await fixture(); const held = deferred<ClientResult<Capabilities>>(); const entered = deferred<void>();
    let signal: AbortSignal | undefined;
    f.calls.mockImplementation(async supplied => { signal = supplied; entered.resolve(); return held.promise; });
    try {
      const source = await f.open(); const original = source.sample(); await entered.promise;
      expect(await source.sample()).toBeNull(); expect(f.calls).toHaveBeenCalledTimes(1);
      let settled = false; const closing = source.close();
      expect(source.close()).toBe(closing); void closing.then(() => { settled = true; });
      await Promise.resolve(); expect(signal?.aborted).toBe(true); expect(settled).toBe(false);
      expect(await source.sample()).toBeNull(); expect(f.gateway.close).not.toHaveBeenCalled();
      held.resolve({ ok: true, value: f.state.frame });
      expect(await original).toBeNull(); await closing;
      expect(settled).toBe(true); expect(f.calls).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
  it('caller abort retains original gateway credit and revokes until a newer source', async () => {
    const f = await fixture(); const held = deferred<ClientResult<Capabilities>>(); const entered = deferred<void>();
    f.calls.mockImplementationOnce(async () => { entered.resolve(); return held.promise; });
    try {
      const source = await f.open(); const abort = new AbortController();
      let settled = false; const original = source.sample(abort.signal); void original.then(() => { settled = true; });
      await entered.promise; abort.abort(); await Promise.resolve();
      expect(settled).toBe(false); expect(await source.sample()).toBeNull(); expect(f.calls).toHaveBeenCalledTimes(1);
      held.resolve({ ok: true, value: f.state.frame }); expect(await original).toBeNull();
      expect(await source.sample()).toBeNull();
      f.state.now = 10400;
      f.state.frame.observation.sampleStartedAtMs = 10300; f.state.frame.observation.observedAtMs = 10310;
      f.state.frame.observation.guards.observedAtMs = 10310;
      expect(await source.sample()).not.toBeNull();
    } finally { await f.cleanup(); }
  });
  it('an already aborted call performs no native or gateway I/O', async () => {
    const f = await fixture();
    try {
      const source = await f.open(); const disk = vi.spyOn(f.disk, 'statfs');
      const abort = new AbortController(); abort.abort();
      expect(await source.sample(abort.signal)).toBeNull();
      expect(disk).not.toHaveBeenCalled(); expect(f.calls).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
  it('retains original statfs through caller abort and shutdown before closing its handle', async () => {
    const f = await fixture(); const held = deferred<BigIntStatsFs>(); const entered = deferred<void>();
    f.disk.statfs = async () => { entered.resolve(); return held.promise; };
    const closingHandle = vi.spyOn(f.disk, 'close');
    try {
      const actual = await f.actual(); const source = await f.open(); const abort = new AbortController();
      const original = source.sample(abort.signal); await entered.promise; abort.abort();
      const closing = source.close(); let settled = false; void closing.then(() => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false); expect(closingHandle).not.toHaveBeenCalled();
      expect(await source.sample()).toBeNull(); held.resolve(actual);
      expect(await original).toBeNull(); await closing; expect(closingHandle).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
  it('retains pending original handle close and invokes it once', async () => {
    const held = deferred<void>(); const entered = deferred<void>(); let handle: FileHandle | undefined;
    const f = await fixture({ close: async original => { handle = original; entered.resolve(); await held.promise; await original.close(); } });
    try {
      const source = await f.open(); const closing = source.close(); let settled = false;
      void closing.then(() => { settled = true; }); await entered.promise;
      expect(handle).toBeDefined(); expect(source.close()).toBe(closing); expect(settled).toBe(false);
      expect(await source.sample()).toBeNull(); held.resolve(); await closing;
    } finally { await f.cleanup(); }
  });
  it.each(['gateway', 'statfs', 'root'])('returns null on %s errors and never exposes exception details', async location => {
    const f = await fixture();
    try {
      const source = await f.open();
      if (location === 'gateway') f.calls.mockRejectedValue(new Error('private-canary'));
      if (location === 'statfs') f.disk.statfs = async () => { throw new Error('private-canary'); };
      if (location === 'root') f.disk.lstat = async () => { throw new Error('private-canary'); };
      expect(await source.sample()).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('keeps failed-close custody unresolved rather than claiming shutdown or retrying close', async () => {
    let handle: FileHandle | undefined; const attempted = deferred<void>();
    const close = vi.fn(async (original: FileHandle) => { handle = original; attempted.resolve(); throw new Error('private-canary'); });
    const f = await fixture({ close }); const source = await f.open();
    const closing = source.close(); let settled = false; void closing.then(() => { settled = true; });
    await attempted.promise; await Promise.resolve();
    expect(source.close()).toBe(closing); expect(settled).toBe(false); expect(close).toHaveBeenCalledTimes(1);
    expect(await source.sample()).toBeNull(); expect(f.gateway.close).not.toHaveBeenCalled();
    // The synthetic failure did not issue a native close; fixture alone cleans its descriptor.
    await nativeDisk.close(handle!); await rm(f.root, { recursive: true, force: true });
  });
});
