import { encodeCanonicalJson, encodeJson, validate } from '@beetle/contracts';
import type { AgentEvent, EventBatch } from '@beetle/contracts';
import { immutableSnapshot } from '../namespaces/index.js';
import { captureEventBinding } from './binding.js';
import { EVENT_BATCH_BYTES, EVENT_BATCH_COUNT, EVENT_RECORD_BYTES, EVENT_ROW_ALLOWANCE, EventBatchError } from './types.js';
import type { EventBatchInput, EventBinding, EventRecord, PreparedEventBatch } from './types.js';

/** Capture only the fixed carrier; the batch retains its independent node/depth budget. */
function readCarrier(input: EventBatchInput): { binding: unknown; after: unknown; batch: unknown } {
  if (input === null || typeof input !== 'object'
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) throw new EventBatchError('invalid_batch');
  let count = 0;
  for (const key in input) {
    if (!Object.hasOwn(input, key)) continue;
    if (++count > 3 || !['binding', 'after', 'batch'].includes(key)) throw new EventBatchError('invalid_batch');
  }
  const fields = ['binding', 'after', 'batch'].map(key => Object.getOwnPropertyDescriptor(input, key));
  if (count !== 3 || fields.some(field => !field || !field.enumerable || !('value' in field))) throw new EventBatchError('invalid_batch');
  return { binding: fields[0]!.value as unknown, after: fields[1]!.value as unknown, batch: fields[2]!.value as unknown };
}
function carrier(input: EventBatchInput): ReturnType<typeof readCarrier> {
  try { return readCarrier(input); }
  catch { throw new EventBatchError('invalid_batch'); }
}
function checkedBatch(input: unknown): EventBatch {
  try {
    const result = validate('EventBatch', JSON.parse(encodeJson(input, EVENT_BATCH_BYTES)) as unknown);
    if (result.ok && result.value.events.length <= EVENT_BATCH_COUNT) return result.value;
  } catch { /* Never expose peer data or serializer diagnostics. */ }
  throw new EventBatchError('invalid_batch');
}
function identities(input: unknown, binding: EventBinding): void {
  if (input === null || typeof input !== 'object') return;
  const expected = binding.key.attempt;
  const value = input as Record<string, unknown>;
  for (const field of ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest'] as const) {
    if (field in value && value[field] !== expected[field]) throw new EventBatchError('identity_mismatch');
  }
  for (const child of Object.values(value)) identities(child, binding);
}
function record(event: AgentEvent): EventRecord {
  try {
    const canonical = encodeCanonicalJson(event, EVENT_RECORD_BYTES);
    return { seq: event.seq, canonical, chargedBytes: Buffer.byteLength(canonical) + EVENT_ROW_ALLOWANCE };
  } catch { throw new EventBatchError('invalid_batch'); }
}
/** Pure bounded evidence capture. Stored durability and all mutations belong to SQL. */
export function prepareEventBatch(input: EventBatchInput): PreparedEventBatch {
  const captured = carrier(input);
  const binding = captureEventBinding(captured.binding);
  const after = captured.after;
  if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0) throw new EventBatchError('invalid_batch');
  const batch = checkedBatch(captured.batch);
  identities(batch, binding);
  if (batch.retainedStartSeq > after && batch.retainedStartSeq - after > 1) throw new EventBatchError('cursor_expired');
  let through = after;
  for (const event of batch.events) {
    if (through === Number.MAX_SAFE_INTEGER || event.seq !== through + 1) throw new EventBatchError('sequence_gap');
    through = event.seq;
  }
  if (batch.nextCursor !== through) throw new EventBatchError('sequence_gap');
  return immutableSnapshot({ binding, after, nextCursor: through,
    retainedStartSeq: batch.retainedStartSeq, records: batch.events.map(record) });
}
