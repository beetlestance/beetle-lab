import type { StorageSettlement } from '../storage-settlement/index.js';
import type { RetirementPipeline } from '../retirement-pipeline/index.js';
import type { Scope } from '../admission/index.js';
import type { LiveMetricRead } from '../live-metrics/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { Capabilities, ProtocolError } from '@beetle/contracts';
import type { InstallationController } from '../installation/index.js';
import type { Journal } from '../journal/index.js';
import type { JournalOutputAbsence } from '../journal/index.js';
import type { OutputSourceReader } from '../output-transfer/index.js';

export interface AgentHttpOptions {
  readonly settlement?: Pick<StorageSettlement,'settle'>;
  /** Explicit trusted pipeline; raw receipt rows cannot service this route. */
  readonly cleanup?: Pick<RetirementPipeline, 'tick'>;
  /** Trusted mounted installation credential, never returned to the browser or engine. */
  readonly credential: string;
  /** Immutable UUID of the exclusively opened journal, bound before serving. */
  readonly journalAuthority: string;
  readonly installation: Pick<InstallationController, 'enqueue' | 'enqueueExport' | 'cancel' | 'cancelOriginal' | 'cancelExportOriginal'>;
  readonly journal: Pick<Journal, 'get' | 'readEvents' | 'acknowledge'>;
  /** Source adapter is explicit; absent service returns a scoped unavailable error. */
  readonly liveMetrics?: (key: Scope, operation: Operation) => Promise<LiveMetricRead>;
  readonly outputs?: OutputSourceReader;
  /** Read-only durable closure capability; transport cannot create absence authority. */
  readonly absences?: Pick<JournalOutputAbsence, 'readOutputAbsence'>;
  capabilities(): Promise<Capabilities>;
}
export interface HttpScope {
  readonly organizationId: string; readonly workspaceId: string; readonly generation: number; readonly attemptId?: string;
}
export class AgentHttpError extends Error {
  constructor(readonly status: number, readonly reason: ProtocolError['reason'],
    readonly retry: ProtocolError['retry'] = 'never') { super('Agent request rejected'); }
}
export const HTTP_LIMITS = Object.freeze({ bytes: 1_048_576, operations: 32, sourceOperations: 2, sockets: 64,
  requestMs: 30_000, headers: 128, headerBytes: 16_384 });
