import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativePort } from '../../src/providers/lease.js';
import type { FilePort } from '../../src/providers/lease.js';
import { readOwnedPrivateFile, readPrivateFile } from '../../src/providers/private-file.js';
import { openInstalledProviders } from '../../src/providers/service.js';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
let directory: string;
let path: string;
beforeEach(async () => {
  directory = await mkdtemp(join(await realpath(tmpdir()), 'provider-custody-'));
  path = join(directory, 'secret'); await writeFile(path, 'retained', { mode: 0o600 });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

it('retains two held original reads through abort and rejects capacity without a queue', async () => {
  const released = deferred<void>(); const issued = deferred<void>(); let count = 0;
  const port: FilePort = { ...nativePort, read: async (handle, bytes, offset) => {
    if (++count === 2) issued.resolve();
    await released.promise; return nativePort.read(handle, bytes, offset);
  } };
  const controller = new AbortController();
  const first = readOwnedPrivateFile(path, 100, { port, signal: controller.signal });
  const second = readOwnedPrivateFile(path, 100, { port, signal: controller.signal });
  const outcomes = Promise.allSettled([first, second]); await issued.promise;
  controller.abort();
  await expect(readPrivateFile(path, 100)).rejects.toMatchObject({ reason: 'busy' });
  let settled = false; void outcomes.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  released.resolve(); expect((await outcomes).every(value => value.status === 'rejected')).toBe(true);
  expect(Buffer.from(await readPrivateFile(path, 100)).toString()).toBe('retained');
});
it('adopts a late original open and closes it once after cancellation', async () => {
  const issued = deferred<void>(); const released = deferred<void>(); let closes = 0;
  const controller = new AbortController();
  const port: FilePort = { ...nativePort,
    open: async (name, flags) => { const handle = await nativePort.open(name, flags); issued.resolve(); await released.promise; return handle; },
    close: async handle => { closes++; await nativePort.close(handle); },
  };
  const work = readOwnedPrivateFile(path, 100, { port, signal: controller.signal });
  const outcome = expect(work).rejects.toMatchObject({ reason: 'closed' });
  await issued.promise; controller.abort(); expect(closes).toBe(0); released.resolve(); await outcome;
  expect(closes).toBe(1);
});
it('retains capacity until original close settles and checks post-close named identity', async () => {
  const issued = deferred<void>(); const released = deferred<void>();
  const port: FilePort = { ...nativePort, close: async handle => { issued.resolve(); await released.promise; await nativePort.close(handle); } };
  const first = readOwnedPrivateFile(path, 100, { port }); const second = readOwnedPrivateFile(path, 100, { port });
  await issued.promise;
  await expect(readPrivateFile(path, 100)).rejects.toMatchObject({ reason: 'busy' });
  await writeFile(path, 'changed', { mode: 0o600 }); released.resolve();
  const outcomes = await Promise.allSettled([first, second]); expect(outcomes.every(value => value.status === 'rejected')).toBe(true);
  expect(Buffer.from(await readPrivateFile(path, 100)).toString()).toBe('changed');
});
it('detects in-flight file mutation and releases a successfully closed original', async () => {
  const port: FilePort = { ...nativePort, read: async (handle, bytes, offset) => {
    const count = await nativePort.read(handle, bytes, offset); await writeFile(path, 'mutation'); return count;
  } };
  await expect(readOwnedPrivateFile(path, 100, { port })).rejects.toMatchObject({ reason: 'io' });
  await expect(readPrivateFile(path, 100)).resolves.toBeInstanceOf(Uint8Array);
});
it('service close aborts and drains independent originals while one read is held', async () => {
  const issued = deferred<void>(); const released = deferred<void>(); const secondClosed = deferred<void>();
  const secondIssued = deferred<void>(); const secondReleased = deferred<void>();
  let reads = 0; let closes = 0;
  const nativeRead = nativePort.read;
  const nativeClose = nativePort.close;
  vi.spyOn(nativePort, 'read').mockImplementation(async (handle, bytes, offset) => {
    reads++;
    if (reads === 1) { issued.resolve(); await released.promise; }
    else { secondIssued.resolve(); await secondReleased.promise; }
    return nativeRead(handle, bytes, offset);
  });
  vi.spyOn(nativePort, 'close').mockImplementation(async handle => {
    await nativeClose(handle); if (++closes === 1) secondClosed.resolve();
  });
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const reference = { name: 'Secret', provider: 'mounted' as const, reference: 'Alias' };
  const service = await openInstalledProviders({ configuration: { inputRoot: directory,
    secretBindings: [{ organizationId, workspaceId, ...reference, source: path }] } });
  const request = { authority: { organizationId, workspaceId, attemptId: organizationId,
    generation: 1, installationId: organizationId, intentDigest: 'a'.repeat(64) }, secret: reference, signal: new AbortController().signal };
  const first = service.secret(request); const observedFirst = Promise.allSettled([first]);
  await issued.promise;
  const second = service.secret(request); const observedSecond = Promise.allSettled([second]);
  await secondIssued.promise;
  const closing = service.close(); secondReleased.resolve(); await secondClosed.promise;
  let settled = false; void closing.then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  released.resolve(); await closing; await observedFirst; await observedSecond;
  expect(closes).toBe(2);
});
it('keeps failed private and mounted closes pending with two permanent logical owners', async () => {
  const failedPrivate = deferred<void>();
  const failClose = async (handle: FileHandle) => { await handle.close(); throw new Error('synthetic close failure'); };
  let privateSettled = false;
  const work = readOwnedPrivateFile(path, 100, { port: { ...nativePort, close: failClose }, failed: () => failedPrivate.resolve() });
  void work.then(() => { privateSettled = true; }, () => { privateSettled = true; });
  await failedPrivate.promise; expect(privateSettled).toBe(false);
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const reference = { name: 'Secret', provider: 'mounted' as const, reference: 'Alias' };
  const service = await openInstalledProviders({ configuration: { inputRoot: directory,
    secretBindings: [{ organizationId, workspaceId, ...reference, source: path }] } });
  const mountedFailed = deferred<void>();
  vi.spyOn(nativePort, 'close').mockImplementation(async handle => {
    await handle.close(); mountedFailed.resolve(); throw new Error('synthetic close failure');
  });
  let mountedSettled = false;
  const mounted = service.secret({ authority: { organizationId, workspaceId, attemptId: organizationId,
    generation: 1, installationId: organizationId, intentDigest: 'a'.repeat(64) }, secret: reference, signal: new AbortController().signal });
  void mounted.then(() => { mountedSettled = true; }, () => { mountedSettled = true; });
  await mountedFailed.promise;
  await expect(service.close()).rejects.toMatchObject({ reason: 'cleanup' });
  expect(mountedSettled).toBe(false);
  await expect(readPrivateFile(path, 100)).rejects.toMatchObject({ reason: 'busy' });
});
