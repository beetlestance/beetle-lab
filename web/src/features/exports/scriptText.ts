import { exportContentPath } from '@beetle/contracts/api';
import type { ExportJob } from '@beetle/contracts/api';
import { responseBody } from '../../lib/response-body.js';

/** Largest script shown inline; bigger scripts are offered as a download only. */
export const maximumShownScriptBytes = 1048576;

async function sha256(bytes: Uint8Array): Promise<string> {
  const value = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads a ready export's script through the content route: one bounded GET of exactly the
 * published byte count, checked against the published SHA-256 and decoded as strict UTF-8.
 */
export async function readScript(job: ExportJob, signal: AbortSignal): Promise<string> {
  const artifact = job.artifact;
  if (job.state !== 'ready' || !artifact) throw new Error('The export is not ready.');
  if (artifact.bytes > maximumShownScriptBytes) throw new Error('The script is too large to show here.');
  const path = exportContentPath({
    organizationId: job.scope.organizationId,
    workspaceId: job.scope.workspaceId,
    exportId: job.id,
  });
  const response = await globalThis.fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`The script could not be read (HTTP ${response.status}).`);
  }
  const bytes = await responseBody(response, { maximum: maximumShownScriptBytes, expected: artifact.bytes }, signal);
  if ((await sha256(bytes)) !== artifact.sha256) throw new Error('The script did not match its SHA-256.');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
