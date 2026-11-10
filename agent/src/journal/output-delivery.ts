import type { DatabaseSync } from 'node:sqlite';
import type { Scope } from '../admission/index.js';
import { receiptForOutputSource } from '../output-source/index.js';
import type { SourceReceipt } from '../output-source/index.js';
import { readSourceState } from './output-source-context.js';
import { copyReceipt, parseSourceJson, requireSource, sameSource, sourceHash, sourceJson, sourceScope } from './output-source-input.js';
import { copyDelivery } from './delivery-input.js';
import { OUTPUT_DELIVERY_BYTES, OUTPUT_DELIVERY_ROW_ALLOWANCE } from './output-delivery-protocol.js';
import type { OutputDeliveryClosure, OutputDeliveryOperation } from './output-delivery-protocol.js';
import { Failure, quotaUsed, transaction } from './sql.js';

export function outputDeliveryOperation(input: { kind: string }): input is OutputDeliveryOperation {
  return input.kind === 'outputDeliveryClose' || input.kind === 'outputDeliveryRead';
}
function storedDelivery(db: DatabaseSync, state: ReturnType<typeof readSourceState>): OutputDeliveryClosure | null {
  const record = db.prepare(`SELECT charged_bytes, CASE WHEN typeof(closure_json)='text'
    AND length(CAST(closure_json AS BLOB))<=${OUTPUT_DELIVERY_BYTES} THEN closure_json ELSE NULL END AS json
    FROM output_delivery_closures WHERE attempt_id=?`).get(state.row.attempt_id);
  try {
    const expectedPending = state.source && !record ? 1 : 0;
    requireSource(state.row.delivery_pending === expectedPending, 'unavailable');
    if (!record) { requireSource(state.row.delivery_bytes === 0, 'unavailable'); return null; }
    requireSource(typeof record.json === 'string', 'unavailable');
    const closure = copyDelivery(parseSourceJson(record.json, OUTPUT_DELIVERY_BYTES));
    requireSource(sourceJson(closure, OUTPUT_DELIVERY_BYTES) === record.json, 'unavailable');
    requireSource(record.charged_bytes === Buffer.byteLength(record.json) + OUTPUT_DELIVERY_ROW_ALLOWANCE
      && state.row.delivery_bytes === record.charged_bytes, 'unavailable');
    requireSource(state.source && state.reservation?.status === 'released', 'unavailable');
    requireSource(sameSource(closure.receipt, receiptForOutputSource(state.source, sourceHash)), 'unavailable');
    requireSource(closure.finalAgentSeq === state.row.last_seq, 'unavailable');
    return closure;
  } catch { throw new Failure('unavailable'); }
}
function closeDelivery(db: DatabaseSync, receipt: SourceReceipt): OutputDeliveryClosure {
  const state = readSourceState(db, receipt.key); const prior = storedDelivery(db, state);
  requireSource(state.source && sameSource(receiptForOutputSource(state.source, sourceHash), receipt), 'conflict');
  if (prior) return prior;
  requireSource(state.reservation?.status === 'released', 'conflict');
  const closure = copyDelivery({ version: 1, receipt, finalAgentSeq: state.row.last_seq });
  const json = sourceJson(closure, OUTPUT_DELIVERY_BYTES); const charge = Buffer.byteLength(json) + OUTPUT_DELIVERY_ROW_ALLOWANCE;
  if (quotaUsed(state.row, { delivery_bytes: charge }) > state.row.quota_bytes) throw new Failure('quota_exceeded');
  db.prepare('INSERT INTO output_delivery_closures(attempt_id,closure_json,charged_bytes) VALUES(?,?,?)')
    .run(receipt.key.attemptId, json, charge);
  return closure;
}
/** Trusted storage boundary only; a producer owner must establish quiescence separately. */
export function executeOutputDelivery(db: DatabaseSync, input: OutputDeliveryOperation): OutputDeliveryClosure | null {
  let value: SourceReceipt | Readonly<Scope>;
  try {
    value = input.kind === 'outputDeliveryClose' ? copyReceipt(parseSourceJson(input.json, OUTPUT_DELIVERY_BYTES)) : sourceScope(input.key);
  } catch { throw new Failure('invalid_input'); }
  return transaction(db, () => input.kind === 'outputDeliveryClose' ? closeDelivery(db, value as SourceReceipt)
    : storedDelivery(db, readSourceState(db, value as Scope)));
}
