import type { EngineResult } from '@beetle/contracts';
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
export type PublicationCode = 'profile' | 'invalid_result' | 'scope' | 'limit' | 'exists'
  | 'filesystem' | 'integrity' | 'cancelled' | 'closed' | 'deadline' | 'clock';
export type PublicationResult = Readonly<{ ok: true; value: EngineResult; relativePath: 'engine-result.json';
  bytes: number; rawSha256: string }> | Readonly<{ ok: false; code: PublicationCode; publication: 'unconfirmed' }>;
export interface ResultPublication {
  readonly result: Promise<PublicationResult>;
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
