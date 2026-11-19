import type { Scope } from '../admission/index.js';
import type { SourceReceipt } from '../output-source/index.js';
import type { StoppedObservation } from './stopped-history-value.js';
import type { OutputDeliveryClosure } from '@beetle/contracts/output-source';
export type { OutputDeliveryClosure } from '@beetle/contracts/output-source';

export const OUTPUT_DELIVERY_BYTES = 1024;
export const OUTPUT_DELIVERY_ROW_ALLOWANCE = 256;
export interface DeliveryHistoryClosure {
  readonly delivery: OutputDeliveryClosure;
  readonly observation: StoppedObservation | null;
}
export interface JournalOutputDelivery {
  closeOutputDelivery(receipt: SourceReceipt, stoppedHistory?: string): Promise<OutputDeliveryClosure>;
  readOutputDelivery(key: Scope): Promise<OutputDeliveryClosure | null>;
}
/** The worker captures the final sequence and binds optional history to that closure. */
export type OutputDeliveryOperation =
  | { readonly kind: 'outputDeliveryClose'; readonly json: string; readonly stoppedHistory?: string }
  | { readonly kind: 'outputDeliveryRead' | 'outputDeliveryHistoryRead'; readonly key: Readonly<Scope> };
