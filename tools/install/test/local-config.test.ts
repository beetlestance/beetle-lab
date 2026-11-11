import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { LocalOptions } from '../local/config.js';
import { deployment, parseLocalOptions } from '../local/config.js';
import { prepareLocalDeployment } from '../local/setup.js';
import { native } from '../local/files.js';
import { canonical, digest } from '../src/capture.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function options(): Promise<LocalOptions> {
  const parent = await fs.realpath(await fs.mkdtemp('/tmp/beetle-w330-config-')); roots.push(parent);
  await fs.chmod(parent, 0o700); await fs.chown(parent, process.getuid!(), process.getgid!());
  return parseLocalOptions(['--directory', join(parent, 'space directory'), '--uid', String(process.getuid!()),
    '--gid', String(process.getgid!()), '--docker-gid', '0', '--docker-socket', '/synthetic/docker.sock', '--port', '8890', '--revision', 'abc123']);
}
const operation = () => ({ signal: new AbortController().signal, deadline: performance.now() + 30000 });
it('creates coherent private options/request/Compose files and replays without changes or authority', async () => {
  const o = await options(); expect(await prepareLocalDeployment(o, operation())).toBe('local_created_fresh');
  for (const directory of [o.directory, join(o.directory, 'setup'), join(o.directory, 'data')]) {
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
  }
  const snapshots = new Map<string, bigint>();
  for (const [name, expected] of deployment(o)) {
    const path = join(o.directory, 'setup', name); const info = await fs.stat(path, { bigint: true });
    snapshots.set(path, info.mtimeNs); expect(Number(info.mode & 0o777n)).toBe(0o600); expect(await fs.readFile(path, 'utf8')).toBe(expected);
  }
  const request = JSON.parse(deployment(o).get('request.json')!);
  expect(request).toMatchObject({ root: join(o.directory, 'data'), uid: o.uid, gid: o.gid,
    dockerSocket: '/var/run/docker.sock', agentContainer: `beetle-${o.instance}-agent`, agentImage: 'beetle-local-agent:abc123',
    externalOrigin: 'http://127.0.0.1:8890', targetNetwork: `beetle-${o.instance}-targets` });
  expect(await fs.readdir(join(o.directory, 'data'))).toEqual([]);
  expect(await prepareLocalDeployment(o, operation())).toBe('local_unchanged_fresh');
  for (const [path, mtime] of snapshots) expect((await fs.stat(path, { bigint: true })).mtimeNs).toBe(mtime);
});
it('recognizes ready receipt without opening serving authority or rewriting runtime settings', async () => {
  const o = await options(); await prepareLocalDeployment(o, operation()); const data = join(o.directory, 'data');
  for (const name of ['config', 'agent', 'backend']) await fs.mkdir(join(data, name), { mode: 0o700 });
  const receipt = { version: 1, operationId: '11111111-1111-4111-8111-111111111111', installationId: '22222222-2222-4222-8222-222222222222',
    phase: 'ready', authority: '33333333-3333-4333-8333-333333333333', configDigests: Object.fromEntries(
      ['installation.json', 'backend-agent.json', 'agent.json', 'agent-token'].map(name => [name, digest('synthetic-config')])),
    requestDigest: digest(canonical(JSON.parse(deployment(o).get('request.json')!))) };
  for (const name of Object.keys(receipt.configDigests)) await fs.writeFile(join(data, 'config', name), 'synthetic-config', { mode: 0o600 });
  await fs.writeFile(join(data, 'installation.json'), JSON.stringify(receipt), { mode: 0o600 });
  await fs.writeFile(join(data, 'backend', 'synthetic-user-settings'), 'preserve', { mode: 0o600 });
  expect(await prepareLocalDeployment(o, operation())).toBe('local_unchanged_ready');
  expect(await fs.readFile(join(data, 'backend', 'synthetic-user-settings'), 'utf8')).toBe('preserve');
  await fs.writeFile(join(data, 'config', 'agent.json'), 'tampered');
  await expect(prepareLocalDeployment(o, operation())).rejects.toMatchObject({ code: 'recovery_required' });
  await fs.writeFile(join(data, 'config', 'agent.json'), 'synthetic-config');
  receipt.phase = 'initializing'; await fs.writeFile(join(data, 'installation.json'), JSON.stringify(receipt));
  await expect(prepareLocalDeployment(o, operation())).rejects.toMatchObject({ code: 'recovery_required' });
});
it.each(['port', 'revision', 'dockerGid', 'dockerSocket'] as const)('rejects changed %s and preserves complete files', async key => {
  const o = await options(); await prepareLocalDeployment(o, operation());
  const changes = { port: 8891, revision: 'def456', dockerGid: 99, dockerSocket: '/other/docker.sock' };
  await expect(prepareLocalDeployment({ ...o, [key]: changes[key] }, operation())).rejects.toMatchObject({ code: 'conflict' });
  expect(await fs.readFile(join(o.directory, 'setup', 'compose.env'), 'utf8')).toBe(deployment(o).get('compose.env'));
});
it('preserves partial configuration and interrupted installation roots', async () => {
  const o = await options(); await fs.mkdir(o.directory, { mode: 0o700 });
  await fs.mkdir(join(o.directory, 'setup'), { mode: 0o700 });
  await expect(prepareLocalDeployment(o, operation())).rejects.toMatchObject({ code: 'recovery_required' });
  expect(await fs.readdir(o.directory)).toEqual(['setup']);
});
it.each(['symlink', 'permissions', 'hardlink', 'oversize'] as const)('rejects unsafe %s files', async kind => {
  const o = await options(); await prepareLocalDeployment(o, operation()); const file = join(o.directory, 'setup', 'options.json');
  if (kind === 'symlink') { const saved = join(roots[0]!, 'saved'); await fs.rename(file, saved); await fs.symlink(saved, file); }
  if (kind === 'permissions') await fs.chmod(file, 0o644);
  if (kind === 'hardlink') await fs.link(file, join(roots[0]!, 'link'));
  if (kind === 'oversize') await fs.writeFile(file, 'x'.repeat(262145));
  await expect(prepareLocalDeployment(o, operation())).rejects.toBeDefined();
});
it('rejects a symlink directory and parent alias', async () => {
  const o = await options(); const alias = join(roots[0]!, 'alias'); await fs.symlink(roots[0]!, alias);
  await expect(prepareLocalDeployment({ ...o, directory: join(alias, 'new') }, operation())).rejects.toBeDefined();
  await fs.symlink(roots[0]!, o.directory);
  await expect(prepareLocalDeployment(o, operation())).rejects.toBeDefined();
});
it('bounds directory enumeration, aborts before creation, and respects deadline', async () => {
  const o = await options(); const controller = new AbortController(); controller.abort();
  await expect(prepareLocalDeployment(o, { ...operation(), signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  await expect(prepareLocalDeployment(o, { ...operation(), deadline: 0 })).rejects.toMatchObject({ code: 'deadline' });
  await fs.mkdir(o.directory, { mode: 0o700 });
  for (let i = 0; i < 4; i++) await fs.writeFile(join(o.directory, String(i)), 'keep');
  await expect(prepareLocalDeployment(o, operation())).rejects.toMatchObject({ code: 'recovery_required' });
  expect((await fs.readdir(o.directory)).length).toBe(4);
});
it('propagates write/sync and close errors while preserving partial state', async () => {
  const o = await options(); const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith('options.json')) vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('synthetic fsync failure'));
    return handle;
  });
  await expect(prepareLocalDeployment(o, operation())).rejects.toThrow('synthetic fsync failure');
  expect(await fs.readdir(join(o.directory, 'setup'))).toEqual(['options.json']);
  await expect(prepareLocalDeployment(o, operation())).rejects.toMatchObject({ code: 'recovery_required' });
});
it('reports native close failure rather than successful setup', async () => {
  const o = await options(); const original = native.open;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args); const close = handle.close.bind(handle);
    vi.spyOn(handle, 'close').mockImplementationOnce(async () => { await close(); throw new Error('synthetic close failure'); });
    return handle;
  });
  await expect(prepareLocalDeployment(o, operation())).rejects.toMatchObject({ code: 'cleanup' });
});
