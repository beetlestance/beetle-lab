import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { OutputDeletionStore } from '../../../src/ports/output-deletion.js';
import type { OutputByteStore, OutputFileContext, OutputFileJob, OutputFileReceipt, OutputFileRecord } from '../../../src/ports/output-bytes.js';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import type { NativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { openStore } from '../../../src/adapters/outbound/files/outputs/store.js';

export const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const context = (): OutputFileContext => ({ deadline: performance.now() + 5000, freeSpaceReserveBytes: 0 });
export function record(bytes = Buffer.from('abc'), token = 7): OutputFileRecord {
  return { binding: { key: { runId: id(3), attempt: { organizationId: id(1), workspaceId: id(2), attemptId: id(4), generation: 1,
    intentDigest: 'a'.repeat(64) } }, journalAuthority: id(5) }, artifact: { ordinal: 0, artifactId: id(6), token: id(token),
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), offset: 0, phase: 'transferring', identity: null,
    writer: id(8), version: 1 } };
}
export function advance(value: OutputFileRecord, receipt: OutputFileReceipt, phase = value.artifact.phase): OutputFileRecord {
  return { binding: value.binding, artifact: { ...value.artifact, identity: receipt.identity, offset: receipt.offset, phase,
    writer: phase === 'published' ? null : value.artifact.writer, version: value.artifact.version + 1 } };
}
export async function finish<T>(job: OutputFileJob<T>): Promise<T> { try { return await job.result; } finally { await job.settled; } }
export function deferred<T = void>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise };
}
export async function pending(promise: Promise<unknown>): Promise<boolean> {
  let done = false; void promise.then(() => { done = true; }, () => { done = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); return !done;
}
export async function fixture(port: NativePort = nativePort, clock?: () => number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-output-bytes-'))); await chmod(root, 0o700);
  const options = { stagingRoot: join(root, 'staging'), publishedRoot: join(root, 'published'), leasePath: join(root, 'namespace.sqlite'), createLease: true };
  await mkdir(options.stagingRoot, { mode: 0o700 }); await mkdir(options.publishedRoot, { mode: 0o700 });
  let store: OutputByteStore & OutputDeletionStore = await openStore(options, { nativePort: port, ...(clock ? { clock } : {}) });
  return { root, options, get store() { return store; },
    path: (value: OutputFileRecord, published = false) => join(published ? options.publishedRoot : options.stagingRoot,
      value.binding.key.attempt.organizationId, value.binding.key.attempt.workspaceId, value.binding.key.runId,
      value.binding.key.attempt.attemptId, value.artifact.token),
    async reopen(next: NativePort = nativePort) { await store.close(); store = await openStore({ ...options, createLease: false }, { nativePort: next, ...(clock ? { clock } : {}) }); return store; },
    async dispose() { await store.close(); await rm(root, { recursive: true, force: true }); },
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export async function populated(files: Fixture, bytes = Buffer.from('abc'), token = 7) {
  let value = record(bytes, token); value = advance(value, await finish(files.store.prepare(value, context())));
  for (let offset = 0; offset < bytes.length;) {
    const next = Math.min(offset + 65_536, bytes.length);
    value = advance(value, await finish(files.store.append({ record: value, offset, bytes: bytes.subarray(offset, next) }, context()))); offset = next;
  }
  return value;
}
