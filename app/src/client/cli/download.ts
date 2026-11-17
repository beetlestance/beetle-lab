import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ExportJob } from '@beetle/contracts/api';
import { ClientError, ensureActive } from './errors.js';
type Artifact = NonNullable<ExportJob['artifact']>;
async function writeChunk(file: FileHandle, chunk: Uint8Array, position: number): Promise<void> {
  let offset = 0;
  for (let calls = 0; offset < chunk.length; calls++) {
    if (calls >= 4096) throw new ClientError('io', 3);
    const wrote = await file.write(chunk, offset, chunk.length - offset, position + offset);
    if (wrote.bytesWritten < 1) throw new ClientError('io', 3);
    offset += wrote.bytesWritten;
  }
}
async function copy(body: ReadableStream<Uint8Array>, file: FileHandle, artifact: Artifact, signal: AbortSignal) {
  const hash = createHash('sha256');
  const reader = body.getReader();
  let written = 0;
  try {
    for (;;) {
      ensureActive(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (written + value.byteLength > artifact.bytes) throw new ClientError('request_failed', 3);
      hash.update(value);
      await writeChunk(file, value, written);
      written += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (written !== artifact.bytes || hash.digest('hex') !== artifact.sha256.toLowerCase())
    throw new ClientError('request_failed', 3);
}
async function acceptedBody(response: Response): Promise<ReadableStream<Uint8Array>> {
  if (response.status === 200 && response.body) return response.body;
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 401 || response.status === 403) throw new ClientError('unavailable', 5);
  throw new ClientError('request_failed', 3);
}
/**
 * Stream one ready export script into a new file. The file is created exclusively and
 * never overwritten; on any failure the partial file this call created is removed, so a
 * present file always matches the published size and SHA-256.
 */
export async function writeExportScript(
  path: string,
  response: Response,
  artifact: Artifact,
  signal: AbortSignal,
): Promise<{ bytes: number; sha256: string }> {
  const body = await acceptedBody(response);
  let file: FileHandle;
  try {
    file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch {
    await body.cancel().catch(() => undefined);
    throw new ClientError('io', 2);
  }
  let failure: unknown;
  let identity: BigIntStats | undefined;
  try {
    identity = await file.stat({ bigint: true });
    await copy(body, file, artifact, signal);
    await file.sync();
  } catch (cause) {
    failure = cause;
  }
  await file.close().catch((cause: unknown) => (failure ??= cause));
  if (failure === undefined) return { bytes: artifact.bytes, sha256: artifact.sha256.toLowerCase() };
  if (identity) await removeOwned(path, identity);
  throw failure instanceof ClientError ? failure : new ClientError('io', 3);
}

/** Remove only the file this call created; a replaced path is left untouched. */
async function removeOwned(path: string, identity: BigIntStats): Promise<void> {
  try {
    const current = await lstat(path, { bigint: true });
    if (current.dev === identity.dev && current.ino === identity.ino) await unlink(path);
  } catch {
    // Nothing to remove, or it is no longer ours.
  }
}
