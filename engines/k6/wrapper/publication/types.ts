import type { EngineResult, ExecutionResult, StandaloneExportResult } from '@beetle/contracts';
import type { JournalScope } from '../control/index.js';

export interface PublicationOptions {
  readonly result: unknown;
  readonly expectedScope: JournalScope;
  readonly directory: string;
  readonly uid: number;
  readonly maximumBytes: number;
  readonly deadlineMs: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly wallNow?: () => number;
}
export interface ExportPublicationOptions extends PublicationOptions {readonly purpose:'standalone_export';readonly assignment:unknown}
export type PublicationCode = 'profile' | 'invalid_result' | 'scope' | 'limit' | 'exists'
  | 'filesystem' | 'integrity' | 'cancelled' | 'closed' | 'deadline' | 'clock';
export type PublicationResult<T extends ExecutionResult = EngineResult> = Readonly<{ ok: true; value: T; relativePath: T extends StandaloneExportResult ? 'export-result.json' : 'engine-result.json';
  bytes: number; rawSha256: string }> | Readonly<{ ok: false; code: PublicationCode; publication: 'unconfirmed' }>;
export interface ResultPublication<T extends ExecutionResult = EngineResult> {
  readonly result: Promise<PublicationResult<T>>;
  /** Original issued IO and descriptor closes; rejects on any original close failure. */
  readonly quiesced: Promise<void>;
  close(): Promise<void>;
}
export class PublicationError extends Error {
  constructor(readonly code: PublicationCode) { super('Result publication failed'); this.name = 'PublicationError'; }
}
export function failure(error: unknown): PublicationResult {
  return Object.freeze({ ok: false, code: error instanceof PublicationError ? error.code : 'filesystem', publication: 'unconfirmed' });
}
