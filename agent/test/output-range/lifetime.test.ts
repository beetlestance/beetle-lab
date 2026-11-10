import { describe, expect, it } from 'vitest';
import { rangeFixture, tracking, deferred } from './fixture.js';
import type { OutputRange } from '../../src/collection/output/index.js';
import type { OutputPorts } from '../../src/collection/output/ports.js';

describe('range original ownership and independent admission', () => {
  const f = rangeFixture();
  it.each(['open', 'read', 'close'] as const)('retains late native %s after abort/deadline/close and refuses before capture', async phase => {
    const artifact = await f.artifact('data.bin', 'body'); const result = f.result(); await f.write(result);
    for (const reason of ['cancelled', 'deadline', 'closed'] as const) {
      const issued = deferred<void>(); const release = deferred<void>(); let held = 0;
      const hold = async () => { if (++held === 2) issued.resolve(); await release.promise; };
      const t = tracking({ ...(phase === 'read' ? { readDone: hold } : {}),
        ...(phase === 'close' ? { closeDone: async path => { if (path.endsWith('data.bin')) await hold(); } } : {}) });
      const ports: OutputPorts = phase === 'open' ? { ...t.ports, open: async (...args) => {
        const handle = await t.ports.open(...args); await hold(); return handle;
      } } : t.ports;
      const controller = new AbortController();
      const options = await f.rangeOptions(artifact, { signal: controller.signal,
        deadline: performance.now() + (reason === 'deadline' ? 200 : 5000) });
      const first = f.range(options, ports); const second = f.range(options, ports); await issued.promise;
      if (reason === 'cancelled') controller.abort();
      const closing = reason === 'closed' ? [first.close(), second.close()] : [];
      expect(await first.result).toEqual({ ok: false, reason }); expect(await second.result).toEqual({ ok: false, reason });
      let traps = 0;
      const forbidden = new Proxy(options, { getOwnPropertyDescriptor() { traps++; throw new Error('must refuse before capture'); } });
      expect(await f.range(forbidden).result).toEqual({ ok: false, reason: 'busy' }); expect(traps).toBe(0);
      expect(await f.collect(f.options(result)).result).toMatchObject({ ok: true });
      let quiet = false; void first.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
      const close = first.close(); expect(first.close()).toBe(close);
      release.resolve(); await Promise.all([...closing, close, second.close(), first.quiesced, second.quiesced]);
      expect(t.closed.length).toBe(t.opened.length);
      expect(await f.range(await f.rangeOptions(artifact)).result).toMatchObject({ ok: true });
    }
  });
  it('keeps failed original descriptor close sticky and closes independent native handles', async () => {
    const artifact = await f.artifact('reports/data.bin', 'body');
    const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ closeDone: async path => {
      if (path.endsWith('data.bin')) { issued.resolve(); await release.promise; throw new Error('private native close failure'); }
    } });
    const operation = f.range(await f.rangeOptions(artifact), t.ports); await issued.promise;
    const closing = operation.close(); const rejection = expect(closing).rejects.toMatchObject({ reason: 'io' });
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' }); release.resolve(); await rejection;
    await operation.quiesced; expect(operation.close()).toBe(closing);
    await expect(operation.close()).rejects.toMatchObject({ reason: 'io' });
    expect(t.closed).toHaveLength(3); expect(new Set(t.closed).size).toBe(3);
  });
  it('suppresses successful reply on original close rejection without cancellation', async () => {
    const artifact = await f.artifact('data.bin', 'body');
    const t = tracking({ closeDone: path => { if (path === f.directory()) throw new Error('native failure'); } });
    const operation = f.range(await f.rangeOptions(artifact), t.ports);
    expect(await operation.result).toEqual({ ok: false, reason: 'io' }); await operation.quiesced;
    await expect(operation.close()).rejects.toMatchObject({ reason: 'io' }); expect(t.closed.length).toBe(t.opened.length);
  });
  it('retains post-close original metadata through cancellation and prevents successful EOF', async () => {
    const artifact = await f.artifact('data.bin', ''); const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking(); let held = false;
    const ports: OutputPorts = { ...t.ports, lstat: new Proxy(t.ports.lstat, { apply: async (target, receiver, args) => {
      const stat: unknown = await Reflect.apply(target, receiver, args);
      if (!held && t.closed.length === 2) { held = true; issued.resolve(); await release.promise; }
      return stat;
    } }) };
    const controller = new AbortController();
    const operation = f.range(await f.rangeOptions(artifact, { signal: controller.signal }), ports);
    let replied = false; void operation.result.then(() => { replied = true; }); await issued.promise; expect(replied).toBe(false);
    controller.abort(); expect(await operation.result).toEqual({ ok: false, reason: 'cancelled' });
    let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
    release.resolve(); await operation.quiesced; await operation.close(); expect(t.reads).toHaveLength(0);
  });
  it('reserves before reentrant descriptor traps and captures the original signal', async () => {
    const artifact = await f.artifact('data.bin', 'body'); const options = await f.rangeOptions(artifact);
    let nested: OutputRange | undefined; let refused: OutputRange | undefined; let reentered = false;
    const input = new Proxy(options, { getOwnPropertyDescriptor(target, key) {
      if (!reentered) { reentered = true; nested = f.range(options); refused = f.range(options); }
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    expect(await f.range(input).result).toMatchObject({ ok: true }); expect(await nested!.result).toMatchObject({ ok: true });
    expect(await refused!.result).toEqual({ ok: false, reason: 'busy' });
    const controller = new AbortController(); const mutable = { ...options, signal: controller.signal };
    const operation = f.range(mutable); mutable.signal = new AbortController().signal; controller.abort();
    expect(await operation.result).toEqual({ ok: false, reason: 'cancelled' });
  });
});
