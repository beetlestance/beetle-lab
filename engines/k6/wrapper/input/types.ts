import type { EngineManifest, Offer, StagedAttempt, StandaloneExportAssignment } from '@beetle/contracts';
import type { CompiledSuite, DeepReadonly, SuiteIssue } from '../../compiler/suite/index.js';
import type { AttemptBudget } from '../../runtime/index.js';

export type InputCode = 'schema' | 'binding' | 'filesystem' | 'input_integrity' | 'input_limit'
  | 'utf8' | 'secret_binding' | 'invalid_config' | 'cancelled' | 'deadline' | 'clock_fenced' | 'closed' | 'already_compiled';
export interface InputFailure { readonly ok: false; readonly code: InputCode; readonly issues?: readonly SuiteIssue[] }
export type InputResult<T> = { readonly ok: true; readonly value: T } | InputFailure;
export interface InputOperation<T> {
  readonly result: Promise<InputResult<T>>;
  /** Settles after all issued IO and the original descriptor closes; rejects if close fails. */
  readonly quiesced: Promise<void>;
}
export interface InstalledEngine {
  readonly id: 'k6'; readonly version: string; readonly configVersion: number;
  readonly configSchema: 'https://beetle.test/contracts/engines/k6/v1/suite';
  readonly resultSchema: 'https://beetle-lab.dev/contracts/runner/v1/engine-result' | 'https://beetle-lab.dev/contracts/runner/v1/export-result';
}
export interface OpenStagedOptions {
  /** Trusted, immutable, read-only mounts and their expected numeric owner. */
  readonly inputRoot: string; readonly secretRoot: string; readonly uid: number;
  readonly installed: InstalledEngine;
  /** Trusted IO ceiling before the admitted deadline is available, 1..60,000 ms. */
  readonly headerTimeoutMs: number;
  /** Optional pins from trusted launch authority, never browser/job parameters. */
  readonly expected?: Readonly<Partial<Pick<StagedAttempt, 'organizationId' | 'workspaceId' | 'attemptId'
    | 'generation' | 'intentDigest' | 'specDigest' | 'offerSha256' | 'manifestSha256'>>>;
  readonly exportAssignment?: {readonly purpose:'standalone_export';readonly assignmentDigest:string};
  readonly signal: AbortSignal; readonly wallNow?: () => number;
}
export interface StagedHeaders {
  readonly assignment?: DeepReadonly<StandaloneExportAssignment>;
  readonly offer: DeepReadonly<Offer>; readonly manifest: DeepReadonly<EngineManifest>;
  readonly staging: DeepReadonly<StagedAttempt>; readonly attempt: Readonly<Extract<AttemptBudget, { mode: 'managed' }>>;
}
export interface CompiledInput { readonly suite: DeepReadonly<CompiledSuite>; readonly attempt: StagedHeaders['attempt'] }
export interface StagedInput extends StagedHeaders {
  compile(): InputOperation<CompiledInput>;
  /** One cached close outcome; failure never becomes a later successful close. */
  close(): Promise<void>;
}
export class InputError extends Error {
  constructor(readonly code: InputCode, readonly issues?: readonly SuiteIssue[]) { super(code); this.name = 'InputError'; }
}
export function failure(error: unknown): InputFailure {
  return Object.freeze({ ok: false, code: error instanceof InputError ? error.code : 'filesystem',
    ...(error instanceof InputError && error.issues ? { issues: error.issues } : {}) });
}
