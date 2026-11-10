import type { BuildOutput } from '../build/index.js';
import type { CompiledSuite, DeepReadonly } from '../plan/index.js';

/** Trusted compiled suite and caller-owned fresh export directory; no secret values. */
export interface StandaloneExportInput {
  readonly suite: DeepReadonly<CompiledSuite>;
  readonly outputDirectory: string;
  readonly timeoutMs: number;
  readonly maximumBuildBytes: number;
}
export type StandaloneExportOutput = BuildOutput;
export type StandaloneExportCode = 'invalid_input' | 'unsupported_secrets' | 'build_failed';
export class StandaloneExportError extends Error {
  constructor(readonly code: StandaloneExportCode) { super(`Standalone export ${code}`); }
}
export type ExportStandaloneScript = (input: StandaloneExportInput) => Promise<StandaloneExportOutput>;
