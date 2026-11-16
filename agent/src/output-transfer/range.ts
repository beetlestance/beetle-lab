import type { ProducerLease } from '../producer-gate/index.js';
import { verifySourceChunk, SOURCE_RANGE_BYTES } from '@beetle/contracts/output-source';
import type { Owned, SourceChunk, SourceChunkRequest } from '@beetle/contracts/output-source';
import type { OutputRangeReader, OutputRangeOptions, OutputRangeResult } from '../collection/output/index.js';
import type { Artifact } from '@beetle/contracts';
import type { Budget } from './budget.js';
import { OutputTransferError } from './errors.js';

const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
export function declaredArtifact(artifacts: readonly Readonly<Artifact>[], request: SourceChunkRequest): Readonly<Artifact> {
  const matches = artifacts.filter(value => value.artifactId.toLowerCase() === request.artifactId.toLowerCase());
  if (matches.length !== 1 || matches[0]!.artifactId !== request.artifactId) throw new OutputTransferError('conflict');
  const artifact = matches[0]!;
  if (request.offset > artifact.bytes) throw new OutputTransferError('invalid_input');
  return artifact;
}
function ownedBytes(value: Uint8Array, expected: number): Uint8Array {
  const size: unknown = Reflect.apply(byteLength, value, []);
  if (!(value instanceof Uint8Array) || size !== expected || expected > SOURCE_RANGE_BYTES) throw new OutputTransferError('unavailable');
  const copy = new Uint8Array(expected); Uint8Array.prototype.set.call(copy, value); return copy;
}
function failure(result: Exclude<OutputRangeResult, { ok: true }>): never {
  if (result.reason === 'busy') throw new OutputTransferError('busy');
  if (['cancelled', 'deadline', 'closed'].includes(result.reason)) throw new OutputTransferError('interrupted');
  throw new OutputTransferError('unavailable');
}

/** Result, true quiescence and the single cached close all retain the service slot. */
export async function readBytes(read: OutputRangeReader, options: OutputRangeOptions, budget: Budget, lease: ProducerLease): Promise<Uint8Array> {
  budget.check(); lease.check();
  let range: ReturnType<OutputRangeReader>;
  let quiet: Promise<boolean>;
  try {
    range = lease.issue(() => read(options));
    quiet = range.quiesced.then(() => true, () => false);
  } catch { lease.poison(); throw new OutputTransferError('unavailable'); }
  let result: OutputRangeResult | undefined; let bytes: Uint8Array | undefined;
  try {
    result = await range.result;
    if (result.ok) bytes = ownedBytes(result.value, Math.min(options.length, options.artifact.bytes - options.offset));
  } catch { result = undefined; }
  const closed = Promise.resolve().then(() => range.close()).then(() => true, () => false);
  const cleanup = await Promise.all([quiet, closed]);
  if (!cleanup.every(Boolean)) lease.poison();
  budget.check();
  if (!cleanup.every(Boolean) || result === undefined) throw new OutputTransferError('unavailable');
  if (!result.ok) failure(result);
  return bytes!;
}
export function chunkValue(request: SourceChunkRequest, artifactBytes: number, bytes: Uint8Array): Owned<SourceChunk> {
  const { length, ...selector } = request; void length;
  try {
    return verifySourceChunk({ ...selector, nextOffset: request.offset + bytes.byteLength, totalBytes: artifactBytes,
      eof: request.offset + bytes.byteLength === artifactBytes,
      base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }, request, artifactBytes);
  } catch { throw new OutputTransferError('unavailable'); }
}
