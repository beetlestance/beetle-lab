import type { AgentRuntimeOptions } from './types.js';

export interface AgentEnvironment extends Readonly<Record<string, string | undefined>> {
  readonly BEETLE_AGENT_CONFIG_FILE?: string;
}
export interface LoadedAgentConfiguration {
  readonly runtime: AgentRuntimeOptions;
  readonly listen: Readonly<{ host: string; port: number }>;
  /** Owned installed providers; runtime composition does not own their external lifetime. */
  close(): Promise<void>;
}
export class AgentConfigurationError extends Error {
  constructor() { super('Agent installation configuration is invalid'); }
}
