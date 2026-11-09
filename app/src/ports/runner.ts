import type { Ack, AckReceipt, AttemptSnapshot, Cancellation, Capabilities, ClientResult,
  EventBatch, Offer } from '@beetle/contracts';
import type { RunProfilePin } from './runs.js';

/** Private installation file shape; bootstrap alone resolves tokenFile. */
export interface AgentConnectionConfiguration {
  readonly version: 1;
  readonly origin: string;
  readonly tokenFile: string;
  readonly expectedInstallationId: string;
  readonly profiles: readonly RunProfilePin[];
  readonly storageAllocationBytes: number;
  readonly freeSpaceReserveBytes: number;
}


/** Captured private file intake; token is never an API value. */
export interface LoadedAgentConfiguration {
  readonly configuration: AgentConnectionConfiguration;
  readonly token: string;
}

/** Immutable expected remote identity, taken from the persisted original attempt. */
export interface RunnerAttemptIdentity {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly intentDigest: string;
}

/** Schema and expected identity checks precede a successful result. No retries.
 * Calls settle only after their original native I/O settles, including on abort.
 */
export interface RunnerAttemptClient {
  offer(body: Offer, signal?: AbortSignal): Promise<ClientResult<AttemptSnapshot>>;
  snapshot(signal?: AbortSignal): Promise<ClientResult<AttemptSnapshot>>;
  cancel(body: Cancellation, signal?: AbortSignal): Promise<ClientResult<AttemptSnapshot>>;
  events(after: number, signal?: AbortSignal): Promise<ClientResult<EventBatch>>;
  ack(body: Ack, signal?: AbortSignal): Promise<ClientResult<AckReceipt>>;
}

/** One installation-owned connection shares bounded original-call credits. */
export interface RunnerGateway {
  capabilities(signal?: AbortSignal): Promise<ClientResult<Capabilities>>;
  attempt(identity: RunnerAttemptIdentity): RunnerAttemptClient;
  close(): Promise<void>;
}
