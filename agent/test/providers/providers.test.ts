import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openInstalledProviders } from '../../src/providers/service.js';
import { readPrivateFile } from '../../src/providers/private-file.js';
import type { InstalledProviders, SecretBinding } from '../../src/providers/types.js';
import type { Authority, InputRequest, SecretRequest } from '../../src/staging/index.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const authority: Authority = { organizationId, workspaceId, attemptId: id, installationId: id, generation: 1, intentDigest: 'a'.repeat(64) };
const secret = { name: '_TOKEN', provider: 'env' as const, reference: 'Alias', version: 'V1' };
const signal = () => new AbortController().signal;
let root: string;
let service: InstalledProviders | undefined;
async function start(bindings: SecretBinding[] = [], environment: Record<string, string | undefined> = {}): Promise<InstalledProviders> {
  service = await openInstalledProviders({ configuration: { inputRoot: root, secretBindings: bindings }, environment });
  return service;
}
function binding(source: string): SecretBinding { return { organizationId, workspaceId, ...secret, source }; }
async function input(bytes: Uint8Array): Promise<{ request: InputRequest; path: string }> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const directory = join(root, organizationId, workspaceId, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, sha256); await writeFile(path, bytes, { mode: 0o600 });
  return { path, request: { authority, input: { id, sha256, bytes: bytes.length }, signal: signal() } };
}
function request(overrides: Partial<SecretRequest['secret']> = {}): SecretRequest {
  return { authority, secret: { ...secret, ...overrides }, signal: signal() };
}
beforeEach(async () => { root = await mkdtemp(join(await realpath(tmpdir()), 'providers-owned-')); });
afterEach(async () => { await service?.close(); service = undefined; await rm(root, { recursive: true, force: true }); });

describe('installed providers', () => {
  it('streams empty and multi-buffer input with bounded independent chunks', async () => {
    const provider = await start();
    for (const size of [0, 180_000]) {
      const value = new Uint8Array(size).fill(42);
      const fixture = await input(value);
      const chunks: Uint8Array[] = [];
      for await (const chunk of await provider.input(fixture.request)) { expect(chunk.length).toBeLessThanOrEqual(65_536); chunks.push(chunk); }
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(value));
    }
  });
  it('does no file I/O for lazy early return and rejects concurrent consumers', async () => {
    const provider = await start();
    const fixture = await input(new Uint8Array([1]));
    await rm(fixture.path);
    const iterable = await provider.input(fixture.request);
    const iterator = iterable[Symbol.asyncIterator]();
    expect(() => iterable[Symbol.asyncIterator]()).toThrow();
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true });
  });
  it('rejects wrong size and namespace, then retains usable capacity', async () => {
    const provider = await start(); const fixture = await input(new Uint8Array([1]));
    const wrong = { ...fixture.request, input: { ...fixture.request.input, bytes: 2 } };
    await expect((await provider.input(wrong))[Symbol.asyncIterator]().next()).rejects.toMatchObject({ reason: 'io' });
    const other = { ...fixture.request, authority: { ...authority, workspaceId: id } };
    await expect((await provider.input(other))[Symbol.asyncIterator]().next()).rejects.toMatchObject({ reason: 'io' });
    for await (const chunk of await provider.input(fixture.request)) expect(chunk).toEqual(new Uint8Array([1]));
  });
  it('pins full secret identity and reads only configured own data variables at resolution', async () => {
    const environment = { PRIVATE_NAME: ' one\n' };
    const provider = await start([binding('PRIVATE_NAME')], environment);
    expect(Buffer.from(await provider.secret(request())).toString()).toBe(' one\n');
    environment.PRIVATE_NAME = 'two';
    expect(Buffer.from(await provider.secret(request())).toString()).toBe('two');
    for (const change of [{ version: 'v1' }, { reference: 'alias' }, { name: '_token' }]) {
      await expect(provider.secret(request(change))).rejects.toMatchObject({ reason: 'invalid_input' });
    }
    const unversioned = { name: secret.name, provider: secret.provider, reference: secret.reference };
    await expect(provider.secret({ ...request(), secret: unversioned })).rejects.toThrow();
    await expect(provider.secret({ ...request(), authority: { ...authority, organizationId: id } })).rejects.toThrow();
  });
  it('rejects inherited/accessor environment values, oversized bytes and duplicate bindings', async () => {
    const environment = Object.create({ PRIVATE_NAME: 'hidden' }) as Record<string, string>;
    const provider = await start([binding('PRIVATE_NAME')], environment);
    await expect(provider.secret(request())).rejects.toThrow();
    Object.defineProperty(environment, 'PRIVATE_NAME', { configurable: true, get: () => { throw new Error('getter invoked'); } });
    await expect(provider.secret(request())).rejects.toMatchObject({ reason: 'invalid_input' });
    Object.defineProperty(environment, 'PRIVATE_NAME', { value: 'é'.repeat(32_769) });
    await expect(provider.secret(request())).rejects.toThrow();
    await expect(openInstalledProviders({ configuration: { inputRoot: root, secretBindings: [binding('A'), binding('B')] } })).rejects.toThrow();
  });
  it('captures only fixed fields and rejects known accessors without executing them', async () => {
    const options = { configuration: { inputRoot: root, secretBindings: [] } };
    Object.defineProperty(options, 'unrelated', { get: () => { throw new Error('unrelated'); } });
    service = await openInstalledProviders(options);
    const hostile = Object.defineProperty({}, 'authority', { get: () => { throw new Error('known'); } });
    await expect(service.secret(hostile as SecretRequest)).rejects.toMatchObject({ reason: 'invalid_input' });
  });
  it('materializes mounted secrets without trimming and bounds private file caps', async () => {
    const path = join(root, 'mounted'); await writeFile(path, ' \nvalue\n', { mode: 0o600 });
    const mounted = { ...binding(path), provider: 'mounted' as const };
    const provider = await start([mounted]);
    expect(Buffer.from(await provider.secret(request({ provider: 'mounted' }))).toString()).toBe(' \nvalue\n');
    for (const cap of [0, 262_145, 1.5]) await expect(readPrivateFile(path, cap)).rejects.toThrow();
    await expect(readPrivateFile(path, 1)).rejects.toThrow();
    expect(await readPrivateFile(path, 262_144)).toBeInstanceOf(Uint8Array);
  });
  it('rejects symlinks, hardlinks, mode, directory and aliased ancestors', async () => {
    const path = join(root, 'private'); await writeFile(path, 'value', { mode: 0o600 });
    const alias = join(root, 'alias'); await symlink(path, alias);
    await expect(readPrivateFile(alias, 10)).rejects.toThrow();
    await rm(alias); await link(path, alias);
    await expect(readPrivateFile(path, 10)).rejects.toThrow();
    await rm(alias); await chmod(path, 0o644);
    await expect(readPrivateFile(path, 10)).rejects.toThrow();
    await expect(readPrivateFile(root, 10)).rejects.toThrow();
    const fifo = join(root, 'fifo'); execFileSync('mkfifo', [fifo], { timeout: 1000 });
    await expect(readPrivateFile(fifo, 10)).rejects.toThrow();
    await symlink(root, alias);
    await expect(readPrivateFile(join(alias, 'private'), 10)).rejects.toThrow();
  });
  it('fences intake and caches return/close while independently closing idle streams', async () => {
    const provider = await start(); const fixture = await input(new Uint8Array(70_000));
    const iterator = (await provider.input(fixture.request))[Symbol.asyncIterator]();
    const next = iterator.next(); await expect(iterator.next()).rejects.toMatchObject({ reason: 'busy' });
    await next;
    const closing = provider.close(); expect(provider.close()).toBe(closing); await closing;
    await expect(provider.input(fixture.request)).rejects.toMatchObject({ reason: 'closed' });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
  it('returns quiescently after next reports a custody failure and native close succeeds', async () => {
    const provider = await start(); const fixture = await input(new Uint8Array(70_000));
    const iterator = (await provider.input(fixture.request))[Symbol.asyncIterator]();
    await iterator.next(); await chmod(fixture.path, 0o400);
    await expect(iterator.next()).rejects.toMatchObject({ reason: 'io' });
    const returned = iterator.return?.();
    expect(iterator.return?.()).toBe(returned);
    await expect(returned).resolves.toMatchObject({ done: true });
    await chmod(fixture.path, 0o600);
    for await (const chunk of await provider.input(fixture.request)) expect(chunk.length).toBeLessThanOrEqual(65_536);
  });
  it('protects reentry from environment descriptor capture and signal registration', async () => {
    const environment = new Proxy({}, { getOwnPropertyDescriptor: () => {
      void service?.close(); return { configurable: true, enumerable: true, writable: true, value: 'value' };
    } });
    const provider = await start([binding('PRIVATE_NAME')], environment);
    await expect(provider.secret(request())).rejects.toMatchObject({ reason: 'closed' });
    await provider.close(); service = undefined;
    const next = await start(); const fixture = await input(new Uint8Array([1]));
    const external = new AbortController().signal;
    const add = external.addEventListener.bind(external);
    external.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => { void next.close(); add(...args); };
    await expect(next.input({ ...fixture.request, signal: external })).rejects.toMatchObject({ reason: 'closed' });
  });
  it('normalizes UUID identities while preserving explicit alias case', async () => {
    const upperOrganization = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const provider = await start([{ ...binding('PRIVATE_NAME'), organizationId: upperOrganization.toUpperCase() }], { PRIVATE_NAME: 'value' });
    const resolved = await provider.secret({ ...request(), authority: { ...authority, organizationId: upperOrganization } });
    expect(Buffer.from(resolved).toString()).toBe('value');
  });
  it('detects parent replacement after stream acquisition', async () => {
    const provider = await start(); const fixture = await input(new Uint8Array(70_000));
    const iterator = (await provider.input(fixture.request))[Symbol.asyncIterator](); await iterator.next();
    const parent = join(root, organizationId); await rename(parent, `${parent}-old`);
    await mkdir(parent, { mode: 0o700 });
    await expect(iterator.next()).rejects.toMatchObject({ reason: 'io' });
  });
});
