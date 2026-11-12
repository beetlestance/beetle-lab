import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NamespaceBinding, verifyInstallation } from '../../src/staging/index.js';
import { namespaceCaps } from '../../src/staging-namespace/index.js';
import { fixture, operation } from '../staging/fixtures.js';
const f = fixture();
async function root(e: Awaited<ReturnType<ReturnType<typeof fixture>['environment']>>) {
  const result = await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() });
  if (!result.ok) throw new Error('Native root verification failed'); return result.value;
}
it('preserves exact installed marker/root identities across re-verification and Journal reopen', async () => {
  const e = await f.environment(false); const marker = join(e.rootPath, namespaceCaps.markerName);
  const before = await lstat(marker, { bigint: true }); const bytes = await readFile(marker);
  expect(before.mode & 0o777n).toBe(0o400n); expect(before.nlink).toBe(1n);
  expect(await readdir(e.rootPath)).toEqual([namespaceCaps.markerName]);
  const first = await e.owner.stagingNamespace.read(); await f.close(e.owner);
  const journal = await f.open(e.journalPath); const fresh = await root(e);
  const binding = new NamespaceBinding({ root: fresh, journal: journal.stagingNamespace, journalAuthority: await journal.journalAuthority(), operation: operation() });
  try { const anchor = await binding.bind(); expect(first?.state).toBe('bound'); if (first?.state !== 'bound') throw new Error('Missing actual binding'); expect(anchor).toEqual(first.anchor); }
  finally { await binding.close(); }
  const after = await lstat(marker, { bigint: true }); expect(after.ino).toBe(before.ino); expect(after.dev).toBe(before.dev);
  expect(await readFile(marker)).toEqual(bytes); expect(await journal.stagingNamespace.read()).toEqual(first);
});
it.each(['missing', 'changed-content', 'replaced-inode', 'symlink', 'writable'])('refuses %s marker without rebinding native custody', async kind => {
  const e = await f.environment(false); const marker = join(e.rootPath, namespaceCaps.markerName);
  const before = await e.owner.stagingNamespace.read(); const original = await readFile(marker);
  if (kind === 'missing') await rm(marker);
  if (kind === 'changed-content') { await chmod(marker, 0o600); await writeFile(marker, Buffer.alloc(original.length, 'x')); await chmod(marker, 0o400); }
  if (kind === 'replaced-inode') { await rename(marker, marker + '.old'); await writeFile(marker, original, { mode: 0o400 }); }
  if (kind === 'symlink') { await rename(marker, marker + '.old'); await symlink(marker + '.old', marker); }
  if (kind === 'writable') await chmod(marker, 0o600);
  const binding = new NamespaceBinding({ root: await root(e), journal: e.owner.stagingNamespace,
    journalAuthority: await e.owner.journalAuthority(), operation: operation() });
  try { await expect(binding.bind()).rejects.toMatchObject({ code: 'recovery_required' }); }
  finally { await binding.close(); }
  expect(await e.owner.stagingNamespace.read()).toEqual(before);
});
it('refuses a new empty root under the same path while preserving the retained original', async () => {
  const e = await f.environment(false); const retained = e.rootPath + '-retained';
  const state = await e.owner.stagingNamespace.read(); await rename(e.rootPath, retained); await mkdir(e.rootPath, { mode: 0o700 });
  try {
    const binding = new NamespaceBinding({ root: await root(e), journal: e.owner.stagingNamespace,
      journalAuthority: await e.owner.journalAuthority(), operation: operation() });
    try { await expect(binding.bind()).rejects.toMatchObject({ code: 'recovery_required' }); } finally { await binding.close(); }
    expect(await readdir(e.rootPath)).toEqual([]); expect(await readFile(join(retained, namespaceCaps.markerName))).not.toHaveLength(0);
    expect(await e.owner.stagingNamespace.read()).toEqual(state);
  } finally { await rm(e.rootPath, { recursive: true, force: true }); await rename(retained, e.rootPath); }
});

it('rejects an actual FIFO marker without blocking an original open or changing the anchor', async () => {
  const e = await f.environment(false); const marker = join(e.rootPath, namespaceCaps.markerName);
  const before = await e.owner.stagingNamespace.read(); await rm(marker);
  await promisify(execFile)('mkfifo', ['-m', '400', marker]);
  const binding = new NamespaceBinding({ root: await root(e), journal: e.owner.stagingNamespace,
    journalAuthority: await e.owner.journalAuthority(), operation: operation() });
  try { await expect(binding.bind()).rejects.toMatchObject({ code: 'recovery_required' }); }
  finally { await binding.close(); }
  expect(await e.owner.stagingNamespace.read()).toEqual(before);
});
