import type { CancelRunRequest, CreateRunRequest, Run, RunPage, RunEngine, WorkspaceScope } from '@beetle/contracts/api';
import type { InstalledIdentity } from '@beetle/contracts';

export interface CreateRunOperation {
  kind: 'createRun';
  id: string;
  attemptId: string;
  requestedAt: string;
  request: CreateRunRequest;
}
export type RunCommand = CreateRunOperation & { intentDigest: string };
/** Monotonic scoped intent; no physical stop or release is inferred from acceptance. */
export interface CancelRunOperation {
  kind: 'cancelRun';
  id: string;
  request: CancelRunRequest;
}
export type CancelRunCommand = CancelRunOperation & { intentDigest: string };
export interface RunCancellationStore { cancel(command: CancelRunCommand): Promise<Run> }
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

/** Trusted installation identities, separate from browser-controlled enqueue fields. */
export interface RunProfilePin {
  engine: RunEngine;
  installedIdentity: InstalledIdentity;
  requiredCapabilities: readonly string[];
}
export interface RunConfiguration { profiles: readonly RunProfilePin[]; pendingLimit: number }
