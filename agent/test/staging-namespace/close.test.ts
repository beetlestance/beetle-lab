import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { NamespaceBinding, Stager, verifyInstallation } from '../../src/staging/index.js';
import type { StagingFilesPort } from '../../src/staging/index.js';
import { fixture, operation } from '../staging/fixtures.js';
const f = fixture();
function gate() { let resolve = () => undefined as void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function native(): StagingFilesPort {
  return { stat: path => lstat(path, { bigint: true }), canonical: realpath, open,
    mkdir: async (path, mode) => { await mkdir(path, { mode }); }, directory: path => opendir(path, { bufferSize: 1 }) };
}
it('holds actual delayed close and cached shutdown past deadline without committing or minting a root token', async () => {
  const e = await f.environment(false); const verified = await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!verified.ok) throw new Error('Missing verified root');
  const held = gate(); const entered = gate(); const files = native(); const original = files.open; let calls = 0; let wrapped = false;
  files.open = async (path, flags, mode) => {
    const handle = await original(path, flags, mode);
    if (path !== e.rootPath || !(flags & constants.O_DIRECTORY) || wrapped) return handle;
    wrapped = true;
    return new Proxy(handle, { get(target, field) {
      if (field === 'close') return async () => { calls++; entered.resolve(); await held.promise; await target.close(); };
      const value: unknown = Reflect.get(target, field, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const commit = vi.spyOn(e.owner.stagingNamespace, 'commit');
  const binding = new NamespaceBinding({ root: verified.value, journal: e.owner.stagingNamespace,
    journalAuthority: await e.owner.journalAuthority(), operation: operation(100), native: files });
  let settled = false; const result = binding.bind().then(() => { settled = true; }, error => { settled = true; return error as unknown; });
  try {
    await entered.promise; await new Promise(resolve => setTimeout(resolve, 125)); expect(settled).toBe(false);
    expect(commit).not.toHaveBeenCalled(); expect(() => new Stager({ ...e.options, root: verified.value })).toThrow('installation');
    let closed = false; const close = binding.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); held.resolve(); await close;
    expect(await result).toMatchObject({ reason: 'deadline' }); expect(calls).toBe(1); expect(commit).not.toHaveBeenCalled();
  } finally { held.resolve(); await binding.close(); commit.mockRestore(); }
});
it('preserves first rejected native close and refuses a false second close or namespace commit', async () => {
  const e = await f.environment(false); const verified = await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!verified.ok) throw new Error('Missing verified root');
  const files = native(); const original = files.open; let calls = 0; let wrapped = false;
  files.open = async (path, flags, mode) => {
    const handle = await original(path, flags, mode);
    if (path !== e.rootPath || !(flags & constants.O_DIRECTORY) || wrapped) return handle;
    wrapped = true;
    return new Proxy(handle, { get(target, field) {
      if (field === 'close') return async () => { calls++; await target.close(); throw new Error('Synthetic native close failed'); };
      const value: unknown = Reflect.get(target, field, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const commit = vi.spyOn(e.owner.stagingNamespace, 'commit'); const before = await e.owner.stagingNamespace.read();
  const binding = new NamespaceBinding({ root: verified.value, journal: e.owner.stagingNamespace,
    journalAuthority: await e.owner.journalAuthority(), operation: operation(), native: files });
  try {
    await expect(binding.bind()).rejects.toThrow('Synthetic native close failed');
    await expect(binding.close()).rejects.toThrow('Synthetic native close failed');
    await expect(binding.close()).rejects.toThrow('Synthetic native close failed');
    expect(calls).toBe(1); expect(commit).not.toHaveBeenCalled();
    expect(() => new Stager({ ...e.options, root: verified.value })).toThrow('installation');
    expect(await e.owner.stagingNamespace.read()).toEqual(before);
  } finally { commit.mockRestore(); }
});
