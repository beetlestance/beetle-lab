import type { Journal } from '../journal/index.js';
import type { OutputGuard } from '../guard/index.js';
import type { TimeoutGuard } from '../timeout/index.js';
import type { ResourceObserver } from './types.js';
import type { RuntimeObservation } from '../admission/index.js';

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export interface PublishedObservation {
  readonly sampleStartedAtMs: number;
  readonly expiresAtMs: number;
  readonly observation: Immutable<RuntimeObservation>;
}

export interface PublisherOptions {
  readonly journal: Pick<Journal, 'admission'>;
  readonly observer: Pick<ResourceObserver, 'sample'>;
  readonly output: Pick<OutputGuard, 'status'>;
  readonly timeout: Pick<TimeoutGuard, 'status'>;
  readonly intervalMs?: number;
  readonly sampleTimeoutMs?: number;
  readonly ttlMs?: number;
  readonly wallNow?: () => number;
  readonly monotonicNow?: () => number;
}
export interface PublisherStatus {
  readonly ready: boolean; readonly running: boolean; readonly closed: boolean; readonly failed: boolean;
  readonly sampling: boolean; readonly publishing: boolean; readonly lastKnownAt: number | null;
}
export interface ObservationPublisher {
  /** First committed fresh known observation, or false on initial failure/expiry/close. */
  readonly initial: Promise<{ readonly ready: boolean }>;
  start(): void;
  status(): PublisherStatus;
  /** Current eligible committed frame; reads never renew its source lease. */
  snapshot(): PublishedObservation | null;
  /** Fences callbacks, drains originals and durably revokes readiness before clean close. */
  close(): Promise<void>;
}
export class PublisherError extends Error {
  constructor(readonly reason: 'invalid_input' | 'busy' | 'closed' | 'cleanup') { super(`Observation publisher ${reason}`); }
}
