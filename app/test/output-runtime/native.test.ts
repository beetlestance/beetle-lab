import { afterEach, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOutputRuntime } from '../../src/bootstrap/output-runtime/index.js';
import { fixture } from './fixture.js';

const roots: string[] = [];
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'beetle-output-runtime-')));
  await chmod(path, 0o700); roots.push(path); return path;
}
afterEach(async () => {vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(path => rm(path, {force: true, recursive: true})));});

it('creates private fixed roots and retained lease, reopens without deleting existing data', async () => {
  const root = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null}); const options = {...f.options, dataRoot: root};
  let runtime = await openOutputRuntime(options);
  try {
    for (const path of ['outputs', 'outputs/staging', 'outputs/published']) {
      expect((await lstat(join(root, path))).mode & 0o7777).toBe(0o700);
    }
    const lease = await lstat(join(root, 'outputs/namespace.sqlite'));
    await writeFile(join(root, 'outputs/published/preserved'), 'synthetic retained data', {mode: 0o600});
    await runtime.close(); runtime = await openOutputRuntime(options);
    expect((await lstat(join(root, 'outputs/namespace.sqlite'))).ino).toBe(lease.ino);
    expect(await readFile(join(root, 'outputs/published/preserved'), 'utf8')).toBe('synthetic retained data');
    expect(f.options.gateway).toHaveProperty('close'); expect(f.files.close).not.toHaveBeenCalled();
  } finally {await runtime.close(); f.dispose();}
});
it('fails startup when an existing namespace has lost its lease and preserves data', async () => {
  const root = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null}); const options = {...f.options, dataRoot: root};
  const runtime = await openOutputRuntime(options); await runtime.close();
  await writeFile(join(root, 'outputs/staging/preserved'), 'keep'); await rm(join(root, 'outputs/namespace.sqlite'));
  await expect(openOutputRuntime(options)).rejects.toThrow();
  await expect(lstat(join(root, 'outputs/namespace.sqlite'))).rejects.toMatchObject({code: 'ENOENT'});
  expect(await readFile(join(root, 'outputs/staging/preserved'), 'utf8')).toBe('keep'); f.dispose();
});
it.each(['outputs', 'staging', 'published'])('refuses a symlink at %s without changing its destination', async name => {
  const root = await directory(); const destination = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null});
  if (name !== 'outputs') await mkdir(join(root, 'outputs'), {mode: 0o700});
  const path = name === 'outputs' ? join(root, name) : join(root, 'outputs', name);
  await writeFile(join(destination, 'preserved'), 'keep'); await symlink(destination, path);
  await expect(openOutputRuntime({...f.options, dataRoot: root})).rejects.toThrow();
  expect((await lstat(path)).isSymbolicLink()).toBe(true); expect(await readFile(join(destination, 'preserved'), 'utf8')).toBe('keep'); f.dispose();
});
it('does not replace a namespace lease on contention and recovers only after the original owner closes', async () => {
  const root = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null}); const options = {...f.options, dataRoot: root};
  const runtime = await openOutputRuntime(options); const lease = await lstat(join(root, 'outputs/namespace.sqlite'));
  await expect(openOutputRuntime(options)).rejects.toThrow();
  expect((await lstat(join(root, 'outputs/namespace.sqlite'))).ino).toBe(lease.ino);
  await runtime.close(); const reopened = await openOutputRuntime(options); await reopened.close(); f.dispose();
});
it('refuses a replaced root during startup and leaves the original data intact', async () => {
  const root = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null}); const options = {...f.options, dataRoot: root};
  const runtime = await openOutputRuntime(options); await runtime.close();
  await rename(join(root, 'outputs/staging'), join(root, 'outputs/previous-staging'));
  await writeFile(join(root, 'outputs/staging'), 'replacement file', {mode: 0o600});
  await expect(openOutputRuntime(options)).rejects.toThrow();
  expect((await lstat(join(root, 'outputs/previous-staging'))).isDirectory()).toBe(true);
  expect(await readFile(join(root, 'outputs/staging'), 'utf8')).toBe('replacement file'); f.dispose();
});
it('captures dependency methods and configuration before foreign startup awaits', async () => {
  const root = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null}); const options = {...f.options, dataRoot: root};
  const runtimePromise = openOutputRuntime(options);
  options.dataRoot = '/mutated'; options.outputs.scan = vi.fn(async () => {throw new Error('Mutated scan');});
  options.gateway.output = vi.fn(() => {throw new Error('Mutated gateway');});
  const runtime = await runtimePromise;
  await new Promise<void>(resolve => setTimeout(resolve, 30)); expect(runtime.state().status).toBe('running');
  await runtime.close(); expect((await lstat(join(root, 'outputs'))).isDirectory()).toBe(true); f.dispose();
});
it.each([0, 24, 60001, Number.NaN])('rejects interval %s before creating files', async intervalMs => {
  const root = await directory(); const f = fixture(); f.outputs.scan.mockResolvedValue({items: [], nextCursor: null});
  await expect(openOutputRuntime({...f.options, dataRoot: root, intervalMs})).rejects.toThrow();
  await expect(lstat(join(root, 'outputs'))).rejects.toMatchObject({code: 'ENOENT'}); f.dispose();
});
it.each(['read', 'adopt', 'finalize', 'observe', 'attempt', 'output'] as const)(
  'rejects missing %s capability before creating native roots', async method => {
    const root = await directory(); const f = fixture();
    const target = ['read', 'adopt', 'finalize'].includes(method) ? f.options.absences
      : method === 'observe' ? f.options.observations : f.options.gateway;
    Reflect.deleteProperty(target, method);
    await expect(openOutputRuntime({...f.options, dataRoot: root})).rejects.toThrow('Invalid output runtime value');
    await expect(lstat(join(root, 'outputs'))).rejects.toMatchObject({code: 'ENOENT'}); f.dispose();
  });

it('requires retirement wiring before acquiring any native output namespace',async()=>{
 const root=await directory();const f=fixture();const {fixture:deletionFixture}=await import('../output-deletion-runtime/fixture.js');const deletion=deletionFixture();
 try{
  await expect(openOutputRuntime({...f.options,dataRoot:root,deletions:deletion.metadata})).rejects.toThrow('mode');
  await expect(lstat(join(root,'outputs'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{f.dispose();}
});
