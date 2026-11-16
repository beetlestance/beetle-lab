import { afterEach, expect, it, vi } from 'vitest';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeName } from '../../src/backends/docker/index.js';
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
  const binding = new library.NamespaceBinding({ root: verified.value, journal: e.owner.stagingNamespace,
    journalAuthority: await e.owner.journalAuthority(), operation: operation() });
  try { await binding.bind(); } finally { await binding.close(); }
  const baselineCalls = new Map(fault.calls);
  return { baselineCalls, e, library, root: verified.value, stager: new library.Stager({ ...e.options, root: verified.value }) };
}

function expectedTaskCloses(environment: Awaited<ReturnType<ReturnType<typeof fixture>['environment']>>): Map<string, number> {
  const root = join(environment.rootPath, runtimeName({ ...scope(environment.offer), installationId: environment.options.profile.installationId }));
  return new Map([environment.rootPath, root, join(root, 'input'), join(root, 'output'), join(root, 'secrets'), join(root, 'input/input-000.bin')]
    .map(path => [path, 1]));
}
function closeDelta(before: ReadonlyMap<string, number>): Map<string, number> {
  const result = new Map<string, number>();
  for (const [path, total] of fault.calls) {
    const count = total - (before.get(path) ?? 0); expect(count).toBeGreaterThanOrEqual(0);
    if (count) result.set(path, count);
  }
  return result;
}
function allTaskDescriptorsClosed(environment: Awaited<ReturnType<ReturnType<typeof fixture>['environment']>>): void {
  for (const path of expectedTaskCloses(environment).keys()) expect(fault.closed.has(path)).toBe(true);
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
  const { e, library, root, stager, baselineCalls } = await isolated();
  const first = stager.prepare({ key: scope(e.offer), operation: operation(500) });
  expect(await first.result).toEqual({ ok: false, reason: 'io' });
  expect(closeDelta(baselineCalls)).toEqual(expectedTaskCloses(e));
  const secondEnvironment = await f.environment();
  const secondRoot = await library.verifyInstallation({ configuration: secondEnvironment.configuration,
    transport: secondEnvironment.transport, operation: operation() });
  if (!secondRoot.ok) throw new Error(secondRoot.reason);
  const secondBinding = new library.NamespaceBinding({ root: secondRoot.value, journal: secondEnvironment.owner.stagingNamespace,
    journalAuthority: await secondEnvironment.owner.journalAuthority(), operation: operation() });
  try { await secondBinding.bind(); } finally { await secondBinding.close(); }
  const secondBaseline = new Map(fault.calls);
  const secondStager = new library.Stager({ ...secondEnvironment.options, root: secondRoot.value });
  const second = secondStager.prepare({ key: scope(secondEnvironment.offer), operation: operation(500) });
  expect(await second.result).toEqual({ ok: false, reason: 'io' });
  expect(await remainsPending(first.quiesced)).toBe(true); expect(await remainsPending(second.quiesced)).toBe(true);
  expect(await remainsPending(stager.close())).toBe(true); expect(await remainsPending(secondStager.close())).toBe(true);
  const third = new library.Stager({ ...e.options, root });
  expect(await third.prepare({ key: scope(e.offer), operation: operation() }).result).toEqual({ ok: false, reason: 'busy' });
  expect(closeDelta(secondBaseline)).toEqual(expectedTaskCloses(secondEnvironment));
  expect(fault.calls.get(join(e.rootPath, runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId }), 'input/input-000.bin'))).toBe(1);
  allTaskDescriptorsClosed(e); allTaskDescriptorsClosed(secondEnvironment);
});
it.each(['cancel', 'deadline'])('keeps a late rejected original close sticky after %s and drain', async kind => {
  const { e, stager, baselineCalls } = await isolated();
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
  expect(closeDelta(baselineCalls)).toEqual(expectedTaskCloses(e)); allTaskDescriptorsClosed(e);
});

it('accepts a definitively successful original close after abort without issuing another close', async () => {
  const { e, stager, baselineCalls } = await isolated();
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
  expect(closeDelta(baselineCalls)).toEqual(expectedTaskCloses(e)); allTaskDescriptorsClosed(e);
});
