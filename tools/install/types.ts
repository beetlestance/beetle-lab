import type { EngineManifest } from '@beetle/contracts';
import type { InstallationValues } from '@beetle/contracts/api';
import type { PoolConfiguration } from '../../agent/src/admission/index.js';
import type { DockerTransport } from '../../agent/src/backends/docker/index.js';

export interface ProvisionRequest {
  readonly root: string;
  readonly uid: number;
  readonly gid: number;
  readonly externalOrigin: string;
  readonly agentOrigin: string;
  readonly dockerSocket: string;
  readonly agentContainer: string;
  readonly agentImage: string;
  readonly engineImage: string;
  readonly targetNetwork: string;
  readonly installationValues: InstallationValues;
  readonly agentPolicy: Omit<PoolConfiguration, 'profiles'>;
  readonly engine: {
    readonly manifest: EngineManifest;
    readonly manifestId: string;
    readonly profileId: string;
    readonly catalogVersion: number;
    readonly configVersion: 1;
    readonly tmpfsBytes: number;
  };
}
export interface ProvisionContext {
  readonly docker: DockerTransport;
  readonly agentWorkerUrl: URL;
  readonly backendWorkerUrl: URL;
  readonly signal: AbortSignal;
  readonly deadline: number;
}
export interface ProvisionResult {
  readonly installationId: string;
  readonly status: 'created' | 'unchanged';
  readonly paths: Readonly<{
    installation: string; backendAgent: string; agent: string; receipt: string;
    backendData: string; agentJournal: string; agentStaging: string;
  }>;
}
export type ProvisionErrorCode = 'invalid_input' | 'inspection' | 'unsafe_root' | 'conflict'
  | 'recovery_required' | 'cancelled' | 'deadline' | 'io' | 'cleanup';
export class ProvisionError extends Error {
  constructor(readonly code: ProvisionErrorCode, options?: ErrorOptions) {
    super('Installation provisioning failed', options); this.name = 'ProvisionError';
  }
}
