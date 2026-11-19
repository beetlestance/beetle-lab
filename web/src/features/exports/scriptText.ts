import type { ExportJob } from '@beetle/contracts/api';
import { readScriptBytes } from './script-bytes.js';
/** Largest script shown inline; downloads retain the separate native 64 MiB ceiling. */
export const maximumShownScriptBytes = 1048576;
/** Exact published bytes are verified before strict UTF-8 decoding for the viewer. */
export async function readScript(job: ExportJob, signal: AbortSignal): Promise<string> {
  const bytes = await readScriptBytes(job, signal, maximumShownScriptBytes);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
