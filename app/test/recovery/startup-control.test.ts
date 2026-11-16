import { mkdtempSync, rmSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { initializeBackendRecovery, openBackendRecovery, openBackendServing } from '../../src/bootstrap/recovery-control/index.js';
import { settingsFixture } from '../domain/fixtures.js';
import { openApplication } from '../../src/bootstrap/api.js';
const opened = vi.hoisted(() => vi.fn(async () => {throw new Error('synthetic metadata refusal');}));
vi.mock('../../src/adapters/outbound/sqlite/index.js', () => ({openMetadata: opened}));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const roots: string[] = [];
afterEach(() => {vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-cold-start-'))); chmodSync(root, 0o700); roots.push(root);
  const path = join(root, 'control.sqlite'); initializeBackendRecovery(path, id);
  return {path, options: {externalOrigin: 'http://127.0.0.1:4311', metadata: {path: join(root, 'metadata.sqlite'), workerUrl: new URL(import.meta.url), installation: settingsFixture().chain.installation, runtime: null}, recoveryControl: {path, installationId: id}}};
}
it('fences metadata and all execution startup while restore is incomplete', async () => {
  const f = fixture(); const offline = openBackendRecovery(f.path, id); offline.begin(id, 'a'.repeat(64)); offline.close();
  await expect(openApplication(f.options)).rejects.toThrow('recovery_required'); expect(opened).not.toHaveBeenCalled();
});
it('refuses serving while an offline owner holds the real lease', async () => {
  const f = fixture(); const offline = openBackendRecovery(f.path, id);
  try {await expect(openApplication(f.options)).rejects.toThrow('owned'); expect(opened).not.toHaveBeenCalled();}
  finally {offline.close();}
});
it('drains an ordinary failed startup before releasing its offline exclusion', async () => {
  const f = fixture(); await expect(openApplication(f.options)).rejects.toThrow('synthetic metadata refusal');
  expect(opened).toHaveBeenCalledOnce(); openBackendServing(f.path, id).close();
});
