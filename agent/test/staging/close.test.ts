import { afterEach, expect, it, vi } from 'vitest';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { scope } from '../admission/fixtures.js';
import { data, fixture, operation, stream } from './fixtures.js';

const fault = vi.hoisted(() => ({
  calls: new Map<string, number>(),
  closed: new Set<string>(),
  rejectFirst: true,
  late: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof FsPromises>();
  const open: typeof actual.open = async (...args) => {
    const target = await actual.open(...args); const path = String(args[0]);
    return new Proxy(target, { get(handle, property) {
      if (property === 'close') return async () => {
        const count = (fault.calls.get(path) ?? 0) + 1; fault.calls.set(path, count);
        await handle.close(); fault.closed.add(path);
        if (path.endsWith('input-000.bin') && count === 1) {
          await fault.late?.();
          if (fault.rejectFirst) throw new Error('FIRST_CLOSE_FAILED');
        }
      };
      const value: unknown = Reflect.get(handle, property, handle);
      return typeof value === 'function' ? value.bind(handle) : value;
    } });
  };
  return { ...actual, open };
});
const f = fixture();
afterEach(() => { fault.calls.clear(); fault.closed.clear(); fault.late = undefined; fault.rejectFirst = true; });

async function remainsPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => false, () => false), new Promise<true>(resolve => setTimeout(() => resolve(true), 30))]);
}
async function isolated() {
  // Permanent unknown state belongs to this module context; no production reset/release exists.
  vi.resetModules();
  const library = await import('../../src/staging/index.js');
  const e = await f.environment();
  const verified = await library.verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!verified.ok) throw new Error(verified.reason);
  return { e, library, root: verified.value, stager: new library.Stager({ ...e.options, root: verified.value }) };
}

it('preserves first-close rejection without retrying and still closes other owned descriptors', async () => {
  const { e, root } = await isolated();
  const { Files } = await import('../../src/staging/files.js');
  const { Boundary } = await import('../../src/staging/bounds.js');
  const { rootIdentity } = await import('../../src/staging/root.js');
  const boundary = new Boundary(operation()); const files = new Files(rootIdentity(root), boundary, async () => undefined);
  const failed = join(e.rootPath, 'input-000.bin'); const other = join(e.rootPath, 'other.bin');
  const broken: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
    next: async () => { throw new Error('SOURCE_FAILED'); },
    return: async () => ({ done: true, value: undefined }),
  }) };
  try {
    await expect(files.file(e.rootPath, 'input-000.bin', stream(), data.length)).rejects.toThrow('FIRST_CLOSE_FAILED');
    await expect(files.file(e.rootPath, 'other.bin', broken, data.length)).rejects.toThrow('SOURCE_FAILED');
    await expect(files.close()).rejects.toThrow('FIRST_CLOSE_FAILED');
    expect(fault.calls.get(failed)).toBe(1); expect(fault.calls.get(other)).toBe(1);
    expect(fault.closed.has(failed)).toBe(true); expect(fault.closed.has(other)).toBe(true);
    await expect(files.close()).rejects.toThrow('FIRST_CLOSE_FAILED');
    expect(fault.calls.get(failed)).toBe(1); expect(fault.calls.get(other)).toBe(1);
  } finally { boundary.dispose(); }
});
it('keeps first-close failure charged and holds two slots, quiesced and service close', async () => {
  const { e, library, root, stager } = await isolated();
  const first = stager.prepare({ key: scope(e.offer), operation: operation(500) });
  expect(await first.result).toEqual({ ok: false, reason: 'io' });
  const secondEnvironment = await f.environment();
  const secondRoot = await library.verifyInstallation({ configuration: secondEnvironment.configuration,
    transport: secondEnvironment.transport, operation: operation() });
  if (!secondRoot.ok) throw new Error(secondRoot.reason);
  const secondStager = new library.Stager({ ...secondEnvironment.options, root: secondRoot.value });
  const second = secondStager.prepare({ key: scope(secondEnvironment.offer), operation: operation(500) });
  expect(await second.result).toEqual({ ok: false, reason: 'io' });
  expect(await remainsPending(first.quiesced)).toBe(true); expect(await remainsPending(second.quiesced)).toBe(true);
  expect(await remainsPending(stager.close())).toBe(true); expect(await remainsPending(secondStager.close())).toBe(true);
  const third = new library.Stager({ ...e.options, root });
  expect(await third.prepare({ key: scope(e.offer), operation: operation() }).result).toEqual({ ok: false, reason: 'busy' });
  expect([...fault.calls.values()]).toEqual([1, 1]); expect(fault.closed.size).toBe(2);
});
it.each(['cancel', 'deadline'])('keeps a late rejected original close sticky after %s and drain', async kind => {
  const { e, stager } = await isolated();
  let started: () => void = () => undefined; let reject: (error: Error) => void = () => undefined;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const late = new Promise<void>((_, fail) => { reject = fail; });
  fault.late = () => { started(); return late; };
  const controller = new AbortController();
  const task = stager.prepare({ key: scope(e.offer), operation: { ...operation(kind === 'deadline' ? 500 : 1000), signal: controller.signal } });
  await entered; if (kind === 'cancel') controller.abort();
  expect(await task.result).toEqual({ ok: false, reason: kind === 'cancel' ? 'cancelled' : 'deadline' });
  expect(await remainsPending(task.quiesced)).toBe(true);
  reject(new Error('LATE_CLOSE_FAILED'));
  expect(await remainsPending(task.quiesced)).toBe(true); expect(await remainsPending(stager.close())).toBe(true);
  expect([...fault.calls.values()]).toEqual([1]); expect(fault.closed.size).toBe(1);
});

it('accepts a definitively successful original close after abort without issuing another close', async () => {
  const { e, stager } = await isolated();
  let started: () => void = () => undefined; let finish: () => void = () => undefined;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const late = new Promise<void>(resolve => { finish = resolve; });
  fault.rejectFirst = false; fault.late = () => { started(); return late; };
  const controller = new AbortController();
  const task = stager.prepare({ key: scope(e.offer), operation: { ...operation(), signal: controller.signal } });
  await entered; controller.abort();
  try {
    expect(await task.result).toEqual({ ok: false, reason: 'cancelled' });
    expect(await remainsPending(task.quiesced)).toBe(true);
  } finally { finish(); }
  await task.quiesced; await stager.close();
  expect([...fault.calls.values()]).toEqual([1]); expect(fault.closed.size).toBe(1);
});
