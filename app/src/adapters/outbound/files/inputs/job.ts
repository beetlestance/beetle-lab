import { InputByteError } from '../../../../ports/input-bytes.js';
import type { InputByteContext, InputByteJob } from '../../../../ports/input-bytes.js';
import { Custody, FileCustodyError } from '../custody/index.js';
import type { NativePort } from '../custody/index.js';

// Reachability is custody, not admission: the service alone limits concurrent jobs.
const owners = new Set<Custody>();
export function fail(code: ConstructorParameters<typeof InputByteError>[0]): never { throw new InputByteError(code); }
export function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}
export function safeError(error: unknown): InputByteError {
  if (error instanceof InputByteError) return error;
  if (error instanceof FileCustodyError) return new InputByteError(error.code);
  return new InputByteError(errorCode(error) === 'ENOSPC' ? 'capacity_unavailable' : 'io');
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
    try { owner.check(); } catch (error) { throw safeError(error); }
    if (failure) throw failure;
    return value as T;
  });
  return { result, settled };
}
