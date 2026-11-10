import type { Scope } from '../admission/index.js';
import type { SourceReceipt } from '../output-source/index.js';

export const OUTPUT_DELIVERY_BYTES = 1024;
export const OUTPUT_DELIVERY_ROW_ALLOWANCE = 256;
/** Immutable stream end under the exact stored source; no publication/deletion authority. */
export interface OutputDeliveryClosure {
  readonly version: 1;
  readonly receipt: SourceReceipt;
  readonly finalAgentSeq: number;
}
export interface JournalOutputDelivery {
  closeOutputDelivery(receipt: SourceReceipt): Promise<OutputDeliveryClosure>;
  readOutputDelivery(key: Scope): Promise<OutputDeliveryClosure | null>;
}
/** Close receives only a receipt. The worker alone captures the final sequence. */
export type OutputDeliveryOperation =
  | { readonly kind: 'outputDeliveryClose'; readonly json: string }
  | { readonly kind: 'outputDeliveryRead'; readonly key: Readonly<Scope> };
