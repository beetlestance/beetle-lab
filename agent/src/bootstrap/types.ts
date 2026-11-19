import type { RetirementPipeline } from '../retirement-pipeline/index.js';
import type { ReconcileOutcome } from '../task-inventory/index.js';
import type { Operation } from '../backends/docker/index.js';
import type { ReconciliationCandidatePage } from '../staging-namespace/index.js';
import type { NativeReceipt } from '../native-receipt/index.js';
import type { NativeRemoval } from '../native-removal/index.js';
import type { TaskInventory } from '../task-inventory/index.js';
import type { RuntimeRetirement } from '../runtime-retirement/index.js';
import type { ProducerRetirement } from '../producer-retirement/index.js';
import type { FastifyInstance } from 'fastify';
import type { PoolConfiguration } from '../admission/index.js';
import type { DockerTransport } from '../backends/docker/index.js';
import type { Catalog } from '../catalog/index.js';
import type { JournalOptions } from '../journal/index.js';
import type { InstallationConfiguration, Providers } from '../staging/index.js';
import type { SchedulerStatus } from '../scheduler/index.js';

export interface AgentRuntimeOptions {
  readonly onStorageFailure?: (error: unknown) => void;
  readonly configurationCheck?: () => Promise<void>;
  readonly journal: JournalOptions;
  readonly installation: InstallationConfiguration;
  readonly transport: DockerTransport;
  readonly catalog: Catalog;
  readonly configuration: Omit<PoolConfiguration, 'profiles'>;
  readonly providers: Providers;
  readonly credential: string;
  readonly minimumFreeBytes: number;
  readonly signal?: AbortSignal;
}
export interface AgentRuntime {
  readonly cleanup: Pick<RetirementPipeline, 'tick' | 'status'>;
  readonly nativeReceipt: Pick<NativeReceipt, 'finalize' | 'status'>;
  readonly nativeRemoval: Pick<NativeRemoval, 'step' | 'status'>;
  readonly taskInventory: Pick<TaskInventory, 'prepare' | 'persist' | 'status'>;
  readonly retiredRuntime: Pick<RuntimeRetirement, 'retire' | 'status'>;
  /** Private process-local port for later authenticated retirement composition; no route implied. */
  readonly retirement: Pick<ProducerRetirement, 'retire' | 'status'>;
  readonly server: FastifyInstance;
  readonly initial: Promise<{ readonly ready: boolean }>;
  status(): {
    readonly ready: boolean;
    readonly closed: boolean;
    readonly retainedActors: number;
    readonly scheduler: SchedulerStatus;
  };
  /** Failed cleanup retains journal/process ownership; never certifies remote dispatch quiescence. */
  close(): Promise<void>;
}
/** Offline operator handle (decision 030); the runtime it came from serves nothing. */
export interface ReconcileRuntime {
  /** Journal-only listing; observes and changes nothing. */
  candidates(after: string | null): Promise<ReconciliationCandidatePage>;
  /** Replays retirement for the stored request, proves runtime absence, then reconciles one task. */
  reconcile(key: ReconcileKey, operation: Operation): Promise<ReconcileOutcome>;
  close(): Promise<void>;
}
export interface ReconcileKey {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly attemptId: string;
  readonly generation: 1;
}
export class AgentRuntimeError extends Error {
  constructor(
    readonly reason: 'busy' | 'startup' | 'recovery_required' | 'closed' | 'cleanup',
    options?: ErrorOptions,
  ) {
    super(`Agent runtime ${reason}`, options);
  }
}
