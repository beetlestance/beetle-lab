import type { CreateRunRequest, Run, RunPage, WorkspaceScope } from '@beetle/contracts/api';

export interface CreateRunOperation {
  kind: 'createRun';
  id: string;
  attemptId: string;
  requestedAt: string;
  request: CreateRunRequest;
}
export type RunCommand = CreateRunOperation & { intentDigest: string };
export interface RunKey { scope: WorkspaceScope; id: string }
export interface RunList { scope: WorkspaceScope; limit: number; cursor?: string }

/** One receipt-first worker transaction owns scoped revision/settings/profile pins,
 * run + attempt + immutable Offer/outbox inserts, queue bound and original response.
 * Request digest excludes allocation IDs/time. No agent/network effects in SQL.
 * Exact replay returns original queued response even after current state changes.
 */
export interface RunStore { execute(command: RunCommand): Promise<Run> }
export interface RunReader {
  getRun(key: RunKey): Promise<Run>;
  listRuns(query: RunList): Promise<RunPage>;
}
