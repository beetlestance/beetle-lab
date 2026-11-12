import { describe, expect, it } from 'vitest';
import { fixture, tracking, deferred } from './fixture.js';
import type { OutputCollection } from '../../src/collection/output/index.js';

describe('original work, cleanup and processwide slots', () => {
  const f = fixture();
  it.each(['cancelled', 'deadline'])('retains both slots through original reads after public %s', async reason => {
    const result = f.result(); await f.write(result); const issued = deferred<void>(); const release = deferred<void>(); let calls = 0;
    const t = tracking({ read: async () => { if (++calls === 2) issued.resolve(); await release.promise; } });
    const controller = new AbortController(); const options = f.options(result, {
      signal: controller.signal, deadline: performance.now() + (reason === 'deadline' ? 200 : 5000),
    });
    const first = f.collect(options, t.ports); const second = f.collect(options, t.ports); await issued.promise;
    if (reason === 'cancelled') controller.abort();
    expect(await first.result).toEqual({ ok: false, reason }); expect(await second.result).toEqual({ ok: false, reason });
    let invoked = 0; const forbidden = { ...options, get deadline() { invoked++; return performance.now() + 5000; } };
    expect(await f.collect(forbidden).result).toEqual({ ok: false, reason: 'busy' }); expect(invoked).toBe(0);
    let quiet = false; void first.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    const closed = [first.close(), second.close()]; release.resolve(); await Promise.all(closed);
    await Promise.all([first.quiesced, second.quiesced]); expect(t.closed.length).toBe(t.opened.length);
    expect(await f.collect(f.options(result)).result).toMatchObject({ ok: true });
  });
  it('owns a late opened parent and caches close until the original settles', async () => {
    const result = f.result(); await f.write(result); const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ open: async () => { issued.resolve(); await release.promise; } });
    const operation = f.collect(f.options(result), t.ports); await issued.promise;
    const closing = operation.close(); expect(await operation.result).toEqual({ ok: false, reason: 'closed' });
    let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    expect(operation.close()).toBe(closing); release.resolve(); await closing; await operation.quiesced;
    expect(t.opened).toHaveLength(1); expect(t.closed).toHaveLength(1);
  });

  it('publishes no success until root close succeeds and performs the final cancellation fence', async () => {
    const result = f.result(); await f.write(result); const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ close: async path => { if (path === f.directory()) { issued.resolve(); await release.promise; } } });
    const controller = new AbortController(); const operation = f.collect(f.options(result, { signal: controller.signal }), t.ports);
    let published = false; void operation.result.then(() => { published = true; }); await issued.promise;
    expect(published).toBe(false); controller.abort(); expect(await operation.result).toEqual({ ok: false, reason: 'cancelled' });
    let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    release.resolve(); await operation.quiesced; await operation.close(); expect(t.closed.length).toBe(t.opened.length);
  });

  it('reserves before descriptor callbacks and preserves call-entry options and signal', async () => {
    const result = f.result(); await f.write(result); const t = tracking(); let nested: OutputCollection | undefined; let busy: OutputCollection | undefined;
    const plain = f.options(result); let reentered = false;
    const input = new Proxy(plain, { getOwnPropertyDescriptor(target, key) {
      if (!reentered) { reentered = true; nested = f.collect(f.options(result)); busy = f.collect(f.options(result)); }
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    const operation = f.collect(input, t.ports);
    expect(await operation.result).toMatchObject({ ok: true }); expect(await nested!.result).toMatchObject({ ok: true });
    expect(await busy!.result).toEqual({ ok: false, reason: 'busy' });
    const original = new AbortController(); const replacement = new AbortController();
    const mutable = { ...f.options(result, { signal: original.signal }) }; const captured = f.collect(mutable);
    mutable.deadline = 0; mutable.outputBytes = 0; mutable.signal = replacement.signal; original.abort();
    expect(await captured.result).toEqual({ ok: false, reason: 'cancelled' });
  });
  it('rejects accessor options without invocation and snapshots mutable data before returning', async () => {
    const result = f.result(); await f.write(result); const t = tracking(); let invoked = 0;
    const input = { ...f.options(result), get deadline() { invoked++; return performance.now() + 5000; } };
    expect(await f.collect(input, t.ports).result).toEqual({ ok: false, reason: 'invalid_options' });
    expect(invoked).toBe(0); expect(t.opened).toHaveLength(0);
    const mutable = { ...f.options(result) }; const operation = f.collect(mutable);
    mutable.deadline = 0; mutable.engineId = 'changed'; mutable.outputBytes = 0;
    expect(await operation.result).toMatchObject({ ok: true });
  });
  it('owns private clock reentrant close before filesystem admission', async () => {
    const result = f.result(); await f.write(result); const t = tracking();
    const operation: OutputCollection = f.collect(f.options(result), { ...t.ports, now: () => { void operation.close(); return performance.now(); } });
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' }); await operation.quiesced; await operation.close();
    expect(t.opened).toHaveLength(0);
  });
  it('fences clock-triggered close after all original descriptors have closed', async () => {
    const result = f.result(); await f.write(result); const t = tracking();
    const operation: OutputCollection = f.collect(f.options(result), { ...t.ports, now: () => {
      if (t.opened.length > 0 && t.closed.length === t.opened.length) void operation.close(); return performance.now();
    } });
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' }); await operation.quiesced;
    await operation.close(); expect(t.closed.length).toBe(t.opened.length);
  });
  it('ignores signal instance overrides while using native abort state', async () => {
    const result = f.result(); await f.write(result); const controller = new AbortController(); let invoked = 0;
    Object.defineProperties(controller.signal, {
      aborted: { get() { invoked++; return false; } },
      addEventListener: { value() { invoked++; throw new Error('unexpected override'); } },
      removeEventListener: { value() { invoked++; throw new Error('unexpected override'); } },
    });
    expect(await f.collect(f.options(result, { signal: controller.signal })).result).toMatchObject({ ok: true }); expect(invoked).toBe(0);
  });
  it.each(['open', 'read'])('owns a late original %s rejection after cancellation', async phase => {
    const result = f.result(); await f.write(result); const issued = deferred<void>(); const release = deferred<void>();
    const hook = async () => { issued.resolve(); await release.promise; throw new Error('secret original failure'); };
    const t = tracking({ [phase]: hook }); const controller = new AbortController();
    const operation = f.collect(f.options(result, { signal: controller.signal }), t.ports); await issued.promise;
    controller.abort(); expect(await operation.result).toEqual({ ok: false, reason: 'cancelled' });
    release.resolve(); await operation.quiesced; await operation.close();
    expect(t.closed.length).toBe(phase === 'open' ? 0 : t.opened.length);
  });
});
