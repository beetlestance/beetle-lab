import { describe, expect, it } from 'vitest';
import { fixture, tracking, deferred } from './fixture.js';
import { nodePorts } from '../../src/collection/control/ports.js';
import type { ReaderPorts } from '../../src/collection/control/ports.js';

describe('original IO ownership', () => {
  const f = fixture();
  it.each(['cancelled', 'deadline', 'closed'])('retains a stalled original open after public %s', async reason => {
    const issued = deferred<void>(); const release = deferred<void>(); const t = tracking(); let calls = 0;
    const ports: ReaderPorts = { ...t.ports, open: async (...args) => {
      calls++; issued.resolve(); await release.promise; return t.ports.open(...args);
    } };
    const reader = f.reader(null, ports); const controller = new AbortController();
    const operation = reader.read({ deadline: performance.now() + (reason === 'deadline' ? 25 : 5000),
      signal: controller.signal, stopped: false });
    await issued.promise;
    let quiet = false; void operation.quiesced.then(() => { quiet = true; });
    if (reason === 'cancelled') controller.abort();
    let closing: Promise<void> | undefined;
    if (reason === 'closed') closing = reader.close();
    expect(await operation.result).toEqual({ ok: false, reason }); expect(quiet).toBe(false);
    if (reason !== 'closed') {
      expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
        .toEqual({ ok: false, reason: 'busy' });
    }
    closing ??= reader.close(); let closed = false; void closing.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    release.resolve(); await operation.quiesced; await closing;
    expect(calls).toBe(1); expect(t.closes()).toBe(1);
    expect(reader.close()).toBe(closing);
  });
  it('does not let busy or invalid budgets cancel the active original read', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`);
    const issued = deferred<void>(); const release = deferred<void>(); let reads = 0;
    const ports: ReaderPorts = { ...nodePorts, open: async (...args) => {
      const handle = await nodePorts.open(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === 'read') return async (...readArgs: unknown[]) => {
          reads++; issued.resolve(); await release.promise; return Reflect.apply(target.read, target, readArgs);
        };
        const field: unknown = Reflect.get(target, property);
        return typeof field === 'function' ? field.bind(target) : field;
      } });
    } };
    const reader = f.reader(null, ports);
    expect(await reader.read({ deadline: Infinity, stopped: false }).result).toEqual({ ok: false, reason: 'invalid_options' });
    const first = reader.read({ deadline: performance.now() + 5000, stopped: false }); await issued.promise;
    expect(await reader.read({ deadline: Infinity, stopped: false }).result).toEqual({ ok: false, reason: 'busy' });
    release.resolve(); expect(await first.result).toMatchObject({ ok: true, value: { kind: 'batch' } });
    await first.quiesced; expect(reads).toBe(2);
  });
  it.each(['cancelled', 'deadline'])('waits for a stalled read after %s, then closes both descriptors', async reason => {
    await f.write(`${JSON.stringify(f.event())}\n`);
    const issued = deferred<void>(); const release = deferred<void>(); let reads = 0; let closes = 0;
    const ports: ReaderPorts = { ...nodePorts, open: async (...args) => {
      const handle = await nodePorts.open(...args);
      return new Proxy(handle, { get(target, property) {
        if (property === 'read') return async (...readArgs: unknown[]) => {
          reads++; issued.resolve(); await release.promise; return Reflect.apply(target.read, target, readArgs);
        };
        if (property === 'close') return async () => { closes++; await target.close(); };
        const field: unknown = Reflect.get(target, property);
        return typeof field === 'function' ? field.bind(target) : field;
      } });
    } };
    const reader = f.reader(null, ports); const controller = new AbortController();
    const operation = reader.read({ deadline: performance.now() + (reason === 'deadline' ? 30 : 5000),
      signal: controller.signal, stopped: false });
    await issued.promise; if (reason === 'cancelled') controller.abort();
    expect(await operation.result).toEqual({ ok: false, reason });
    const closing = reader.close(); expect(closes).toBe(0); release.resolve();
    await operation.quiesced; await closing; expect(reads).toBe(1); expect(closes).toBe(2);
  });
  it('caches late original close rejection and independently closes the parent', async () => {
    await f.write(''); const issued = deferred<void>(); const release = deferred<void>(); let closes = 0;
    const ports: ReaderPorts = { ...nodePorts, open: async (...args) => {
      const handle = await nodePorts.open(...args); const isFile = String(args[0]).endsWith('control.ndjson');
      return new Proxy(handle, { get(target, property) {
        if (property === 'close') return async () => {
          closes++; await target.close();
          if (isFile) { issued.resolve(); await release.promise; throw new Error('private system detail'); }
        };
        const field: unknown = Reflect.get(target, property);
        return typeof field === 'function' ? field.bind(target) : field;
      } });
    } };
    const reader = f.reader(null, ports); const operation = reader.read({ deadline: performance.now() + 5000, stopped: false });
    await operation.result; await operation.quiesced;
    const closing = reader.close(); const rejected = expect(closing).rejects.toMatchObject({ reason: 'io', message: 'Control reader io' });
    await issued.promise; expect(closes).toBe(2); expect(reader.close()).toBe(closing);
    release.resolve(); await rejected;
    await expect(reader.close()).rejects.toMatchObject({ reason: 'io' });
  });
});
