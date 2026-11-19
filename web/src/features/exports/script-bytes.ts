import { exportContentPath } from '@beetle/contracts/api';
import type { ExportJob } from '@beetle/contracts/api';
import { responseBody } from '../../lib/response-body.js';
export const maximumExportScriptBytes = 64 * 1024 * 1024;

/** One same-origin GET bound to captured publication metadata; never re-encodes script text. */
export async function readScriptBytes(
  job: ExportJob,
  signal: AbortSignal,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const { expected, digest, path } = selection(job, maximum);
  signal.throwIfAborted();
  const response = await globalThis.fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  let bodyOwned = false;
  try {
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`The script could not be read (HTTP ${response.status}).`);
    bodyOwned = true;
    const bytes = await responseBody(response, { profile: 'export-script', maximum, expected }, signal);
    signal.throwIfAborted();
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    signal.throwIfAborted();
    const actual = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== digest) throw new Error('The script did not match its SHA-256.');
    return bytes;
  } finally {
    if (!bodyOwned && response.body && !response.body.locked) await response.body.cancel();
  }
}
let downloadActive = false;
/** No queue: a retired or timed-out original retains the one slot until it really settles. */
export async function readVerifiedDownload(job: ExportJob, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal.throwIfAborted();
  if (downloadActive) throw new Error('Another export download is still finishing. Try again when it settles.');
  downloadActive = true;
  const timeout = new AbortController();
  const combined = AbortSignal.any([signal, timeout.signal]);
  const timer = setTimeout(() => timeout.abort(), 30000);
  try {
    return await readScriptBytes(job, combined, maximumExportScriptBytes);
  } finally {
    clearTimeout(timer);
    timeout.abort();
    downloadActive = false;
  }
}

function selection(job: ExportJob, maximum: number) {
  const artifact = job.artifact;
  if (job.state !== 'ready' || !artifact) throw new Error('The export is not ready.');
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > maximumExportScriptBytes ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 1 ||
    artifact.bytes > maximum ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  )
    throw new Error('The script exceeds the download limit or has invalid metadata.');
  const expected = artifact.bytes,
    digest = artifact.sha256;
  const path = exportContentPath({
    organizationId: job.scope.organizationId,
    workspaceId: job.scope.workspaceId,
    exportId: job.id,
  });
  return { expected, digest, path };
}
