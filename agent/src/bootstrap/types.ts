import type { FastifyInstance } from 'fastify';
import type { PoolConfiguration } from '../admission/index.js';
import type { DockerTransport } from '../backends/docker/index.js';
import type { Catalog } from '../catalog/index.js';
import type { JournalOptions } from '../journal/index.js';
import type { InstallationConfiguration, Providers } from '../staging/index.js';
import type { SchedulerStatus } from '../scheduler/index.js';

export interface AgentRuntimeOptions {
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
  readonly server: FastifyInstance;
  readonly initial: Promise<{ readonly ready: boolean }>;
  status(): { readonly ready: boolean; readonly closed: boolean; readonly retainedActors: number; readonly scheduler: SchedulerStatus };
  /** Failed cleanup retains journal/process ownership; never certifies remote dispatch quiescence. */
  close(): Promise<void>;
}
export class AgentRuntimeError extends Error {
  constructor(readonly reason: 'busy' | 'startup' | 'recovery_required' | 'closed' | 'cleanup') { super(`Agent runtime ${reason}`); }
}
