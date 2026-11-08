import { readFile, mkdtemp, rm } from 'node:fs/promises';
import type { EngineResult } from '@beetle/contracts';
import type { PublicationOptions } from '../../wrapper/publication/index.js';
import { nodeIo } from '../../wrapper/publication/ports.js';
import type { PublicationFile, PublicationIo } from '../../wrapper/publication/ports.js';

export async function fixture(): Promise<EngineResult> {
  return JSON.parse(await readFile(new URL('../../../../contracts/fixtures/seal-v1/passed-result.json', import.meta.url), 'utf8')) as EngineResult;
}
export type TestInput = { -readonly [K in keyof PublicationOptions]: PublicationOptions[K] };
export async function input(): Promise<TestInput> {
  const result = await fixture();
  return { result, expectedScope: { organizationId: result.organizationId, workspaceId: result.workspaceId,
    attemptId: result.attemptId, generation: result.generation }, directory: await mkdtemp('/private/tmp/beetle-publication-'),
    uid: process.getuid!(), maximumBytes: 1_048_576, deadlineMs: Date.now() + 10_000, timeoutMs: 5000 };
}
export async function clean(options: PublicationOptions): Promise<void> { await rm(options.directory, { recursive: true, force: true }); }
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function overrideFile(io: PublicationIo, mutate: (file: PublicationFile, directory: boolean) => PublicationFile): PublicationIo {
  return { ...io, open: async (path, flags, mode) => mutate(await io.open(path, flags, mode), mode === undefined) };
}
export function fileProxy(file: PublicationFile, overrides: Partial<PublicationFile>): PublicationFile {
  return { stat: () => file.stat(), sync: () => file.sync(), close: () => file.close(),
    write: (buffer, offset, length, position) => file.write(buffer, offset, length, position), ...overrides };
}
export { nodeIo };
