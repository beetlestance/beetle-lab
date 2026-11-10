import type { EngineResult } from '@beetle/contracts';
import type { Journal } from '../journal/index.js';
import type { Supervisor, LaunchInput, LaunchState } from '../supervisor/index.js';
import type { ControlReaderFactory } from '../collection/control/index.js';
import type { OutputCollector } from '../collection/output/index.js';
import type { Operation } from '../backends/docker/index.js';

export type ControllerJournal = Pick<Journal, 'admission' | 'readOffer' | 'get' | 'supervision'
  | 'readWrapperCheckpoint' | 'commitWrapperBatch' | 'journalAuthority'>;
/** Trusted composition for one admitted, staged runtime; never browser options. */
export interface AttemptControllerOptions {
  readonly journal: ControllerJournal;
  readonly supervisor: Pick<Supervisor, 'actor' | 'retire'>;
  readonly input: LaunchInput;
  readonly collectOutputs: OutputCollector;
  readonly wallNow?: () => number;
}
export interface ControllerPorts extends AttemptControllerOptions {
  readonly createReader: ControlReaderFactory;
}
export type AttemptProgress =
  | { readonly kind: 'deferred'; readonly reason: 'journal_busy' }
  | { readonly kind: 'runtime'; readonly state: LaunchState }
  | { readonly kind: 'control'; readonly events: number }
  | { readonly kind: 'verifying'; readonly phase: 'restart' | 'final'; readonly verifiedBytes: number; readonly targetBytes: number }
  | { readonly kind: 'awaiting_collection'; readonly reason: 'busy' }
  | { readonly kind: 'awaiting_release'; readonly collection: 'finished' | 'failed' }
  | { readonly kind: 'released'; readonly collection: 'finished' | 'failed' };
export interface CollectionObservation {
  readonly state: 'finished' | 'failed';
  /** Content/custody evidence only. Never infer application outcome from this field. */
  readonly result?: Readonly<EngineResult>;
  readonly observedAt: number;
}
export type ControllerReason = 'invalid_input' | 'busy' | 'closed' | 'cancelled' | 'deadline'
  | 'journal' | 'supervisor' | 'cleanup' | 'clock';
export class ControllerError extends Error {
  constructor(readonly reason: ControllerReason) { super(`Attempt controller ${reason}`); }
}
export type ControllerBudget = Operation;
