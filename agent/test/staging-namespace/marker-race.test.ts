import { expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, open, opendir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NamespaceBinding, Stager, verifyInstallation } from '../../src/staging/index.js';
import type { StagingFilesPort } from '../../src/staging/index.js';
import { namespaceCaps } from '../../src/staging-namespace/index.js';
import { fixture, operation } from '../staging/fixtures.js';
const f = fixture();
function native(): StagingFilesPort {
  return { stat: path => lstat(path, { bigint: true }), canonical: realpath, open,
    mkdir: async (path, mode) => { await mkdir(path, { mode }); }, directory: path => opendir(path, { bufferSize: 1 }) };
}
it.each(['unlink', 'replace', 'edit', 'read-edit'])('refuses a marker %s during its original close before commit or token installation', async kind => {
  const e = await f.environment(false); const marker = join(e.rootPath, namespaceCaps.markerName); const content = await readFile(marker);
  const verified = await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!verified.ok) throw new Error('Invalid fresh root');
  const files = native(); const original = files.open; let fired = false;
  files.open = async (path, flags, mode) => {
    const handle = await original(path, flags, mode);
    if (path !== marker || fired) return handle; fired = true;
    let edited = false;
    return new Proxy(handle, { get(target, field) {
      if (field === 'read' && kind === 'read-edit') return async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const result = await target.read(buffer, offset, length, position);
        if (!edited && result.bytesRead > 0) {
          edited = true; await chmod(marker, 0o600); await writeFile(marker, Buffer.alloc(content.length, 'x')); await chmod(marker, 0o400);
        }
        return result;
      };
      if (field === 'close') return async () => {
        await target.close();
        if (kind === 'unlink') await rm(marker);
        if (kind === 'replace') { await rename(marker, marker + '.old'); await writeFile(marker, content, { mode: 0o400 }); }
        if (kind === 'edit') { await chmod(marker, 0o600); await writeFile(marker, Buffer.alloc(content.length, 'x')); await chmod(marker, 0o400); }
      };
      const value: unknown = Reflect.get(target, field, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const before = await e.owner.stagingNamespace.read(); const commit = vi.spyOn(e.owner.stagingNamespace, 'commit');
  const binding = new NamespaceBinding({ root: verified.value, journal: e.owner.stagingNamespace,
    journalAuthority: await e.owner.journalAuthority(), operation: operation(), native: files });
  try {
    await expect(binding.bind()).rejects.toMatchObject({ code: 'recovery_required' }); expect(fired).toBe(true);
    expect(commit).not.toHaveBeenCalled(); expect(() => new Stager({ ...e.options, root: verified.value })).toThrow('installation');
    expect(await e.owner.stagingNamespace.read()).toEqual(before);
  } finally { await binding.close(); commit.mockRestore(); }
});
it('does not publish a native token if the marker changes during an already committed metadata reply', async () => {
  const e = await f.environment(false); const marker = join(e.rootPath, namespaceCaps.markerName);
  const verified = await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!verified.ok) throw new Error('Invalid fresh root');
  const port = { ...e.owner.stagingNamespace, commit: async (input: Parameters<typeof e.owner.stagingNamespace.commit>[0]) => {
    const anchor = await e.owner.stagingNamespace.commit(input); await rm(marker); return anchor;
  } };
  const binding = new NamespaceBinding({ root: verified.value, journal: port, journalAuthority: await e.owner.journalAuthority(), operation: operation() });
  try {
    await expect(binding.bind()).rejects.toMatchObject({ code: 'recovery_required' });
    expect(() => new Stager({ ...e.options, root: verified.value })).toThrow('installation');
  } finally { await binding.close(); }
});
