import { exportContentPath } from '@beetle/contracts/api';
import type { ApiClient, ExportJob } from '@beetle/contracts/api';
import { clientFailure } from './auth.js';
import { writeExportScript } from './download.js';
import { ClientError, ensureActive } from './errors.js';
import type { WaitClock } from './wait.js';
export function exportTerminal(job: ExportJob): boolean {
  return ['ready', 'failed', 'cancelled', 'unknown'].includes(job.state);
}
/** ready 0; failed or unknown publication 3; cancelled 4; still pending at the deadline 5. */
export function exportExit(job: ExportJob): number {
  if (!exportTerminal(job)) return 5;
  if (job.state === 'ready') return 0;
  return job.state === 'cancelled' ? 4 : 3;
}
interface WaitInput {
  api: ApiClient;
  job: ExportJob;
  deadline: number;
  signal: AbortSignal;
  clock: WaitClock;
}
const expired = (input: WaitInput) => input.signal.aborted || input.clock.now() >= input.deadline;
/** Same cadence and bounds as run waiting: sequential reads every 2 s, at most 1801. */
export async function waitForExport(input: WaitInput): Promise<ExportJob> {
  let current = input.job;
  for (let reads = 0; reads < 1801 && !exportTerminal(current); reads++) {
    const remaining = input.deadline - input.clock.now();
    if (remaining <= 0 || input.signal.aborted) return current;
    try {
      await input.clock.sleep(Math.min(2000, remaining), input.signal);
    } catch {
      return current;
    }
    if (expired(input)) return current;
    const { organizationId, workspaceId } = current.scope;
    const result = await input.api.getExport({
      params: { organizationId, workspaceId, exportId: current.id },
      signal: input.signal,
    });
    if (expired(input)) return current;
    if (!result.ok) clientFailure(result.error);
    current = result.value;
  }
  return current;
}
interface DownloadInput {
  api: ApiClient;
  content: (path: string, signal: AbortSignal) => Promise<Response>;
  params: { organizationId: string; workspaceId: string; exportId: string };
  outFile: string;
  signal: AbortSignal;
}
/** Read the job, require a ready artifact, then stream and verify it into a new file. */
export async function downloadExport(input: DownloadInput): Promise<{ value: object; exit: number }> {
  const { api, content, params, outFile, signal } = input;
  const read = await api.getExport({ params, signal });
  ensureActive(signal);
  if (!read.ok) clientFailure(read.error);
  const job = read.value;
  if (job.state !== 'ready' || !job.artifact) throw new ClientError('unavailable', 5);
  let response: Response;
  try {
    response = await content(exportContentPath(params), signal);
  } catch {
    throw new ClientError(signal.aborted ? 'interrupted' : 'request_failed', signal.aborted ? 5 : 3);
  }
  const written = await writeExportScript(outFile, response, job.artifact, signal);
  return { value: { downloaded: true, exportId: job.id, name: job.artifact.name, ...written }, exit: 0 };
}
