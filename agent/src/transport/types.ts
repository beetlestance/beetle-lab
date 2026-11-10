import type { Capabilities, ProtocolError } from '@beetle/contracts';
import type { InstallationController } from '../installation/index.js';
import type { Journal } from '../journal/index.js';
import type { JournalOutputAbsence } from '../journal/index.js';
import type { OutputSourceReader } from '../output-transfer/index.js';

export interface AgentHttpOptions {
  /** Trusted mounted installation credential, never returned to the browser or engine. */
  readonly credential: string;
  /** Immutable UUID of the exclusively opened journal, bound before serving. */
  readonly journalAuthority: string;
  readonly installation: Pick<InstallationController, 'enqueue' | 'cancel' | 'cancelOriginal'>;
  readonly journal: Pick<Journal, 'get' | 'readEvents' | 'acknowledge'>;
  /** Source adapter is explicit; absent service returns a scoped unavailable error. */
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
