import { describe, expect, it } from 'vitest';
import { fixture, tracking, value } from './fixture.js';
import type { ControlReader, ControlReadOperation, ControlReadBudget } from '../../src/collection/control/index.js';

describe('ownership before caller callbacks', () => {
  const f = fixture();
  it.each(['close', 'read'])('rejects a budget getter without invoking its reentrant %s', async action => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking(); const reader = f.reader(null, t.ports);
    let invoked = 0;
    const input = { get deadline() {
      invoked++;
      if (action === 'close') void reader.close();
      else reader.read({ deadline: performance.now() + 5000, stopped: false });
      return performance.now() + 5000;
    }, stopped: false };
    const operation = reader.read(input);
    expect(await operation.result).toEqual({ ok: false, reason: 'invalid_options' });
    await operation.quiesced; expect(invoked).toBe(0); expect(t.opens()).toBe(0);
    expect(await value(reader)).toMatchObject({ kind: 'batch' });
    await reader.close(); expect(t.closes()).toBe(2);
  });
  it('keeps the outer owner when a budget descriptor trap attempts a nested read', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking(); const reader = f.reader(null, t.ports);
    let nested: ControlReadOperation | undefined;
    const input = new Proxy({ deadline: performance.now() + 5000, stopped: false }, {
      getOwnPropertyDescriptor(target, key) {
        nested = reader.read({ deadline: performance.now() + 5000, stopped: false });
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const outer = reader.read(input); expect(await outer.result).toMatchObject({ ok: true, value: { kind: 'batch' } });
    expect(nested).toBeDefined(); expect(await nested!.result).toEqual({ ok: false, reason: 'busy' });
    await outer.quiesced; await reader.close(); expect(t.opens()).toBe(2); expect(t.closes()).toBe(2);
  });
  it('owns close called from a budget descriptor trap before any filesystem admission', async () => {
    const t = tracking(); const reader = f.reader(null, t.ports); let closing: Promise<void> | undefined;
    const input = new Proxy({ deadline: performance.now() + 5000, stopped: false }, {
      getOwnPropertyDescriptor(target, key) { closing = reader.close(); return Reflect.getOwnPropertyDescriptor(target, key); },
    });
    const operation = reader.read(input);
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' });
    await operation.quiesced; await closing; expect(t.opens()).toBe(0); expect(reader.close()).toBe(closing);
  });
  it.each([1, 2, 3, 4])('owns a reentrant close from clock callback %s', async at => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking();
    let closing: Promise<void> | undefined; let calls = 0;
    const reader: ControlReader = f.reader(null, { ...t.ports, now: () => {
      calls++; if (calls === at) closing = reader.close(); return performance.now();
    } });
    const operation = reader.read({ deadline: performance.now() + 5000, stopped: false });
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' });
    await operation.quiesced; await closing;
    expect(t.opens()).toBe(0); expect(reader.close()).toBe(closing);
    expect(await reader.read({ deadline: performance.now() + 5000, stopped: false }).result)
      .toEqual({ ok: false, reason: 'closed' });
  });
  it('keeps a clock-triggered nested read busy throughout operation setup', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking();
    const nested: ControlReadOperation[] = [];
    const reader: ControlReader = f.reader(null, { ...t.ports, now: () => {
      nested.push(reader.read({ deadline: performance.now() + 5000, stopped: false })); return performance.now();
    } });
    const operation = reader.read({ deadline: performance.now() + 5000, stopped: false });
    expect(await operation.result).toMatchObject({ ok: true, value: { kind: 'batch' } }); await operation.quiesced;
    expect(nested.length).toBeGreaterThan(3);
    for (const attempt of nested) expect(await attempt.result).toEqual({ ok: false, reason: 'busy' });
    await reader.close(); expect(t.closes()).toBe(2);
  });
  it('uses native signal state/listeners without invoking reentrant instance overrides', async () => {
    await f.write(`${JSON.stringify(f.event())}\n`); const t = tracking(); const reader = f.reader(null, t.ports);
    const controller = new AbortController(); let invoked = 0;
    Object.defineProperties(controller.signal, {
      aborted: { get() { invoked++; void reader.close(); return false; } },
      addEventListener: { value() { invoked++; void reader.close(); } },
      removeEventListener: { value() { invoked++; void reader.close(); } },
    });
    const operation = reader.read({ deadline: performance.now() + 5000, stopped: false, signal: controller.signal });
    expect(await operation.result).toMatchObject({ ok: true, value: { kind: 'batch' } }); await operation.quiesced;
    expect(invoked).toBe(0); await reader.close(); expect(t.closes()).toBe(2);
  });
  it('owns reentrant close during signal validation without late IO', async () => {
    const t = tracking(); const reader = f.reader(null, t.ports); let closing: Promise<void> | undefined;
    const signal = new Proxy(new AbortController().signal, {
      getPrototypeOf(target) { closing = reader.close(); return Reflect.getPrototypeOf(target); },
    });
    const input: ControlReadBudget = { deadline: performance.now() + 5000, stopped: false, signal };
    const operation = reader.read(input); expect(await operation.result).toEqual({ ok: false, reason: 'closed' });
    await operation.quiesced; await closing; expect(t.opens()).toBe(0); expect(reader.close()).toBe(closing);
  });
  it('captures deadline, stopped and the original signal before read returns', async () => {
    await f.write('{'); const t = tracking(); const reader = f.reader(null, t.ports);
    const original = new AbortController(); const replacement = new AbortController();
    const budget = { deadline: performance.now() + 5000, stopped: false, signal: original.signal };
    const first = reader.read(budget);
    budget.deadline = 0; budget.stopped = true; budget.signal = replacement.signal;
    expect(await first.result).toMatchObject({ ok: true, value: { kind: 'caught_up', tail: 'incomplete' } });
    await first.quiesced; const calls = t.reads.length;
    const nextBudget = { deadline: performance.now() + 5000, stopped: false, signal: original.signal };
    const next = reader.read(nextBudget); nextBudget.signal = replacement.signal; original.abort();
    expect(await next.result).toEqual({ ok: false, reason: 'cancelled' }); await next.quiesced;
    expect(t.reads).toHaveLength(calls); await reader.close(); expect(t.closes()).toBe(2);
  });
});
