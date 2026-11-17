import type { prepareReservation } from '../retention-accounting/facts.js';
import type { prepareExpiry, prepareClock } from '../retention-accounting/expiry.js';
import type { prepareRetentionApply } from '../retention-apply/facts.js';
import type { prepareRetentionCompletion } from '../retention-progress/facts.js';
export type Prepared = ReturnType<typeof prepareReservation>;
export interface ReservationFrame {
  readonly kind: 'reserve';
  readonly prepared: Prepared;
  phase: 'epoch' | 'snapshot' | 'usage' | 'storage';
}
export interface ExpiryFrame {
  readonly kind: 'expiry';
  readonly prepared: NonNullable<ReturnType<typeof prepareExpiry>>;
  phase: 'progress_delete' | 'delete' | 'usage' | 'storage';
}
export interface ClockFrame {
  readonly kind: 'clock';
  readonly prepared: ReturnType<typeof prepareClock>;
  phase: 'storage';
}
export interface ApplyFrame {
  readonly kind: 'apply';
  readonly prepared: ReturnType<typeof prepareRetentionApply>;
  phase: 'child' | 'progress' | 'applied';
  ordinal: number;
}
export interface CompletionFrame {
  readonly kind: 'completion';
  readonly prepared: Extract<ReturnType<typeof prepareRetentionCompletion>, { readonly ready: true }>;
  phase: 'complete';
}
export type Frame = ReservationFrame | ExpiryFrame | ClockFrame | ApplyFrame | CompletionFrame;
