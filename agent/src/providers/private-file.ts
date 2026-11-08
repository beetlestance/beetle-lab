import { check } from './capture.js';
import { FileLease } from './lease.js';
import type { FilePort } from './lease.js';
import { privatePath } from './root.js';
import { ProviderError } from './types.js';

export async function readPrivateFile(path: string, maximumBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  return readOwnedPrivateFile(path, maximumBytes, { signal });
}
interface ReadOptions { readonly signal?: AbortSignal | undefined; readonly port?: FilePort; readonly failed?: () => void }
function validate(maximum: number, signal?: AbortSignal): void {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 262_144) throw new ProviderError('invalid_input');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new ProviderError('invalid_input');
  check(signal);
}
async function consume(lease: FileLease, maximum: number, signal?: AbortSignal): Promise<Uint8Array> {
  await lease.open(maximum, signal);
  const output = new Uint8Array(lease.size);
  let offset = 0;
  while (offset < output.byteLength) {
    const chunk = await lease.read(offset, Math.min(65_536, output.byteLength - offset), signal);
    if (chunk.byteLength === 0) throw new ProviderError('io');
    output.set(chunk, offset); offset += chunk.byteLength;
  }
  check(signal); return output;
}
/** Internal seam supports held original/failure tests without replacing production filesystem custody. */
export async function readOwnedPrivateFile(path: string, maximumBytes: number,
  options: ReadOptions = {}): Promise<Uint8Array> {
  privatePath(path); validate(maximumBytes, options.signal);
  const lease = FileLease.acquire(path, options.port);
  let result: Uint8Array | undefined;
  let failure: unknown;
  try { result = await consume(lease, maximumBytes, options.signal); }
  catch (error) { failure = error instanceof ProviderError ? error : new ProviderError('io'); }
  try { await lease.close(); }
  catch (error) {
    if (lease.failed) { options.failed?.(); await lease.retainFailure(); }
    throw error instanceof ProviderError ? error : new ProviderError('io');
  }
  check(options.signal);
  if (failure) throw failure;
  if (!result) throw new ProviderError('io');
  return result;
}
