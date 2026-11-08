import type { Journal } from '../journal/index.js';
import type { OutputGuard } from '../guard/index.js';
import type { TimeoutGuard } from '../timeout/index.js';
import type { ResourceObserver } from './types.js';

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
  /** Fences callbacks, drains originals and durably revokes readiness before clean close. */
  close(): Promise<void>;
}
export class PublisherError extends Error {
  constructor(readonly reason: 'invalid_input' | 'busy' | 'closed' | 'cleanup') { super(`Observation publisher ${reason}`); }
}
