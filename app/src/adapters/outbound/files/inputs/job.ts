import type { FileHandle } from 'node:fs/promises';
import { InputByteError } from '../../../../ports/input-bytes.js';
import type { InputByteContext, InputByteJob } from '../../../../ports/input-bytes.js';
import type { NativePort } from './native.js';

// Reachability is custody, not admission: the service alone limits concurrent jobs.
const owners = new Set<Custody>();
export function fail(code: ConstructorParameters<typeof InputByteError>[0]): never { throw new InputByteError(code); }
export function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}
export function safeError(error: unknown): InputByteError {
  if (error instanceof InputByteError) return error;
  return new InputByteError(errorCode(error) === 'ENOSPC' ? 'capacity_unavailable' : 'io');
}
export class Custody {
  private readonly handles = new Set<FileHandle>();
  constructor(readonly port: NativePort, readonly context: InputByteContext) {}
  check(): void {
    if (this.context.signal?.aborted) fail('cancelled');
    if (!Number.isSafeInteger(this.context.freeSpaceReserveBytes) || this.context.freeSpaceReserveBytes < 0) fail('invalid_input');
  }
  async open(path: string, flags: number, mode?: number): Promise<FileHandle> {
    this.check();
    const handle = await this.port.open(path, flags, mode);
    this.handles.add(handle); this.check(); return handle;
  }
  async close(): Promise<boolean> {
    let closed = true;
    for (const handle of this.handles) {
      try { await this.port.close(handle); this.handles.delete(handle); }
      catch { closed = false; }
    }
    return closed;
  }
}
export function startJob<T>(port: NativePort, context: InputByteContext,
  work: (owner: Custody) => Promise<T>): InputByteJob<T> {
  const captured: InputByteContext = { ...context };
  const owner = new Custody(port, captured); owners.add(owner);
  let release!: () => void;
  const settled = new Promise<void>(resolve => { release = resolve; });
  const result = Promise.resolve().then(async () => {
    let value: T | undefined;
    let failure: InputByteError | undefined;
    try { owner.check(); value = await work(owner); owner.check(); }
    catch (error) { failure = safeError(error); }
    const closed = await owner.close();
    if (!closed) fail('cleanup');
    owners.delete(owner); release();
    owner.check();
    if (failure) throw failure;
    return value as T;
  });
  return { result, settled };
}
