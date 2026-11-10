import { capture, checked, fields, integer, requireInput } from '@beetle/contracts/output-source/internal';
import type { Scope } from '../admission/index.js';
import type { SourceReceipt } from '../output-source/index.js';
import { OUTPUT_DELIVERY_BYTES } from './output-delivery-protocol.js';
import type { OutputDeliveryClosure } from './output-delivery-protocol.js';
import { copyReceipt, matchScope, sameSource, sourceJson } from './output-source-input.js';

/** Own the complete bounded value before reply matching or worker serialization. */
export function copyDelivery(input: unknown): OutputDeliveryClosure {
  return checked(() => {
    const value = fields(capture(input, OUTPUT_DELIVERY_BYTES), 'version,receipt,finalAgentSeq');
    requireInput(value.version === 1); integer(value.finalAgentSeq);
    const result = { version: 1 as const, receipt: copyReceipt(value.receipt), finalAgentSeq: value.finalAgentSeq };
    sourceJson(result, OUTPUT_DELIVERY_BYTES); return Object.freeze(result);
  });
}
export function deliveryReply(input: unknown, expected: Scope | SourceReceipt): OutputDeliveryClosure {
  const result = copyDelivery(input);
  if ('key' in expected) requireInput(sameSource(result.receipt, expected));
  else matchScope(result.receipt.key, expected);
  return result;
}
