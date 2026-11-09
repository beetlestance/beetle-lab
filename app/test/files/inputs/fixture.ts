import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InputRecord } from '../../../src/ports/inputs.js';
import type { InputByteJob, InputByteStore } from '../../../src/ports/input-bytes.js';
import { nativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import type { NativePort } from '../../../src/adapters/outbound/files/inputs/native.js';
import { openStore } from '../../../src/adapters/outbound/files/inputs/store.js';

export const context = { freeSpaceReserveBytes: 0 };
export const scope = {
  kind: 'workspace' as const,
  organizationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
};
export function record(bytes: Uint8Array = new Uint8Array()): InputRecord {
  return { scope: { ...scope }, id: '33333333-3333-4333-8333-333333333333',
    folderId: '44444444-4444-4444-8444-444444444444', name: 'synthetic input',
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength,
    offset: 0, version: 1, state: 'staging', reason: null };
}
export interface Fixture {
  root: string; stagingRoot: string; publishedRoot: string; store: InputByteStore;
  path(input: InputRecord, published?: boolean): string;
  seed(input: InputRecord, bytes: Uint8Array, published?: boolean): Promise<void>;
  reopen(port?: NativePort): Promise<InputByteStore>;
  dispose(): Promise<void>;
}
export async function fixture(port: NativePort = nativePort): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-w40-inputs-')));
  const stagingRoot = join(root, 'staging'); const publishedRoot = join(root, 'published');
  await chmod(root, 0o700); await mkdir(stagingRoot, { mode: 0o700 }); await mkdir(publishedRoot, { mode: 0o700 });
  const options = { stagingRoot, publishedRoot };
  const path = (input: InputRecord, published = false) => join(published ? publishedRoot : stagingRoot,
    input.scope.organizationId, input.scope.workspaceId, input.id, input.sha256);
  return { root, ...options, path, store: await openStore(options, port),
    async seed(input, bytes, published = false) {
      let parent = published ? publishedRoot : stagingRoot;
      for (const component of [input.scope.organizationId, input.scope.workspaceId, input.id]) {
        parent = join(parent, component); await mkdir(parent, { mode: 0o700 }).catch(error => {
          if (error.code !== 'EEXIST') throw error;
        });
      }
      await writeFile(path(input, published), bytes, { mode: 0o600, flag: 'wx' });
    },
    reopen: (native = nativePort) => openStore(options, native),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
}
export async function finish<T>(job: InputByteJob<T>): Promise<T> {
  try { return await job.result; } finally { await job.settled; }
}
export function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
export async function pending(promise: Promise<unknown>): Promise<boolean> {
  let done = false; void promise.then(() => { done = true; }, () => { done = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); return !done;
}
