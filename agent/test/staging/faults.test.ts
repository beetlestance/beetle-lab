import { expect, it, vi, afterEach } from 'vitest';
import { lstat, readdir } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeName } from '../../src/backends/docker/index.js';
import { scope } from '../admission/fixtures.js';
import { data, fixture, operation } from './fixtures.js';

const fault = vi.hoisted(() => ({ kind: '', onWrite: undefined as (() => Promise<void>) | undefined }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof FsPromises>();
  const open: typeof actual.open = async (...args) => {
    const handle = await actual.open(...args);
    if (!String(args[0]).endsWith('input-000.bin')) return handle;
    return new Proxy(handle, { get(target, property) {
      if (property === 'write') return async (...values: unknown[]) => {
        await fault.onWrite?.();
        if (fault.kind === 'short') return { bytesWritten: 0, buffer: values[0] };
        return Reflect.apply(target.write, target, values);
      };
      if (property === 'sync' && fault.kind === 'sync') return async () => { throw new Error('SYNTHETIC_SENTINEL'); };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  return { ...actual, open };
});
const f = fixture();
afterEach(() => { fault.kind = ''; fault.onWrite = undefined; });
it.each(['short', 'sync'])('preserves evidence and refuses a plan after %s syscall failure', async kind => {
  const e = await f.environment(); fault.kind = kind;
  const task = e.prepare(e.create());
  expect(await task.result).toEqual({ ok: false, reason: 'io' }); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  expect(await readdir(join(e.rootPath, name, 'input'))).not.toContain('staging.json');
  expect((await lstat(join(e.rootPath, name, 'input/input-000.bin'))).size).toBe(kind === 'short' ? 0 : data.length);
});
it('holds the active boundary through late kernel writes without publishing metadata or a plan', async () => {
  const e = await f.environment(); let entered: () => void = () => undefined; let finish: () => void = () => undefined;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  fault.onWrite = async () => { entered(); await pending; };
  const controller = new AbortController();
  const stager = e.create(); const task = stager.prepare({ key: scope(e.offer), operation: { ...operation(), signal: controller.signal } });
  await started; controller.abort();
  expect(await task.result).toEqual({ ok: false, reason: 'cancelled' });
  let done = false; void task.quiesced.then(() => { done = true; }); expect(done).toBe(false);
  finish(); await task.quiesced;
  const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
  expect(await readdir(join(e.rootPath, name, 'input'))).toEqual(['input-000.bin']);
});
