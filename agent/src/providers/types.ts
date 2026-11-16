import type { Providers } from '../staging/index.js';

export interface SecretBinding {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly provider: 'env' | 'mounted';
  readonly reference: string;
  readonly version?: string;
  /** Installation-owned environment variable name or absolute private file path. */
  readonly source: string;
}
export interface ProviderConfiguration {
  readonly inputRoot: string;
  readonly secretBindings: readonly SecretBinding[];
}
export interface ProviderOptions {
  readonly configuration: ProviderConfiguration;
  /** Only configured variable names are read, at resolution time; never snapshot the whole environment. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}
export interface InstalledProviders extends Providers {
  /** Fence intake and independently drain owned streams/reads; never releases execution reservations. */
  close(): Promise<void>;
}
export class ProviderError extends Error {
  constructor(readonly reason: 'invalid_input' | 'configuration' | 'closed' | 'busy' | 'io' | 'cleanup') {
    super(`Installed provider ${reason}`);
  }
}
