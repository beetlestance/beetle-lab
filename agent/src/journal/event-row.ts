import { validate } from '@beetle/contracts';
import type { AgentEvent } from '@beetle/contracts';
import { AGENT_EVENT_BYTES, CONTROL_FRAME_BYTES } from '../control-protocol/index.js';
import type { Row } from './attempt-row.js';
import type { EventInput, GenerationKey } from './protocol.js';
import { EVENT_ROW_OVERHEAD_BYTES, eventInput, eventKey, MAX_SUPERVISOR_INPUT_BYTES } from './event-input.js';
import { canonical } from './input.js';
import { sqlTextColumn, sqlIntegerColumn } from './sql-columns.js';
import { storedRecord, storedInteger, storedJson } from './row-values.js';
import { Failure } from './failure.js';
export interface EventLengthRow {
  seq: number;
  encoded_bytes: number;
}
export interface PruneEventRow extends EventLengthRow {
  source: 'wrapper' | 'agent';
  source_key: number;
  charged_bytes: number;
}
export const eventLengthColumns = [
  sqlIntegerColumn('seq'),
  sqlIntegerColumn('encoded_bytes'),
  "CASE WHEN typeof(event_json)='text' THEN length(CAST(event_json AS BLOB)) ELSE NULL END AS actual_bytes",
].join(',');
export const pruneEventColumns = [
  eventLengthColumns,
  sqlTextColumn('source', 8),
  sqlIntegerColumn('source_key'),
  sqlIntegerColumn('charged_bytes'),
  "CASE WHEN typeof(canonical_json)='text' THEN length(CAST(canonical_json AS BLOB)) ELSE NULL END AS canonical_bytes",
].join(',');
export const storedEventColumn = sqlTextColumn('event_json', AGENT_EVENT_BYTES);
export function captureEventLength(input: unknown): EventLengthRow {
  const row = storedRecord(input);
  const seq = storedInteger(row.seq, 1, Number.MAX_SAFE_INTEGER - 1);
  const bytes = storedInteger(row.encoded_bytes, 1, AGENT_EVENT_BYTES);
  if (row.actual_bytes !== bytes) throw new Failure('unavailable');
  return { seq, encoded_bytes: bytes };
}
export function capturePruneEvent(input: unknown, owner: Row): PruneEventRow {
  const row = storedRecord(input);
  const lengths = captureEventLength(row);
  if (row.source !== 'wrapper' && row.source !== 'agent') throw new Failure('unavailable');
  const high = row.source === 'wrapper' ? owner.wrapper_high : owner.supervisor_high;
  const sourceKey = storedInteger(row.source_key, 1, high);
  const maximum = row.source === 'wrapper' ? CONTROL_FRAME_BYTES - 1 : MAX_SUPERVISOR_INPUT_BYTES;
  const canonicalBytes = storedInteger(row.canonical_bytes, 1, maximum);
  const charged = storedInteger(row.charged_bytes, 1);
  if (charged !== lengths.encoded_bytes + canonicalBytes + EVENT_ROW_OVERHEAD_BYTES) throw new Failure('unavailable');
  return { ...lengths, source: row.source, source_key: sourceKey, charged_bytes: charged };
}
export function captureStoredEvent(input: unknown, key: GenerationKey, seq?: number): AgentEvent {
  const raw = storedJson(input, AGENT_EVENT_BYTES);
  const parsed = validate('AgentEvent', raw);
  if (!parsed.ok) throw new Failure('unavailable');
  const value = parsed.value;
  if (canonical(eventKey(value)) !== canonical(eventKey(key))) throw new Failure('unavailable');
  if (seq !== undefined && value.seq !== seq) throw new Failure('unavailable');
  if (
    (value.kind === 'engine.result' || value.kind === 'export.result') &&
    canonical(eventKey(value.payload)) !== canonical(eventKey(key))
  )
    throw new Failure('unavailable');
  return value;
}
export function captureSourceReplay(input: unknown, owner: Row, expected: EventInput): AgentEvent {
  const row = storedRecord(input);
  const event = captureStoredEvent(row.event_json, ownerKey(owner));
  if (event.source !== expected.source || event.seq > owner.last_seq) throw new Failure('unavailable');
  const original: Record<string, unknown> = { ...event };
  try {
    let copy: EventInput;
    if (event.source === 'wrapper') {
      if (event.wrapperSeq !== expected.sourceKey) throw new Failure('unavailable');
      original.seq = expected.sourceKey;
      delete original.wrapperSeq;
      delete original.source;
      copy = eventInput(original, 'wrapper');
    } else {
      delete original.seq;
      copy = eventInput({ sourceOrdinal: expected.sourceKey, event: original }, 'agent');
    }
    if (copy.canonical !== row.canonical_json) throw new Failure('unavailable');
  } catch {
    throw new Failure('unavailable');
  }
  return event;
}
export function ownerKey(row: Row): GenerationKey {
  return {
    attemptId: row.attempt_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    generation: row.generation,
  };
}
