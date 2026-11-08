import type { DatabaseSync } from 'node:sqlite';
import { encodeJson, validate } from '@beetle/contracts';
import type { AgentEvent, ControlEvent } from '@beetle/contracts';
import { eventInput, eventKey, MAX_EVENT_BYTES } from './event-input.js';
import type { Row } from './sql.js';
import type { EventInput } from './protocol.js';
import { Failure, owner, transaction } from './sql.js';
import { project } from './projection.js';

export function append(db: DatabaseSync, input: EventInput): AgentEvent {
  const checked = eventInput(input.source === 'wrapper' ? JSON.parse(input.json) :
    { sourceOrdinal: input.sourceKey, event: JSON.parse(input.json) }, input.source);
  if (checked.canonical !== input.canonical || checked.sourceKey !== input.sourceKey) throw new Failure('invalid_input');
  return transaction(db, () => appendAtomic(db, checked));
}
export function appendAtomic(db: DatabaseSync, input: EventInput): AgentEvent {
  const row = owner(db, input.key);
  const { expired, high, counter } = sourceCounters(row, input.source);
  if (input.sourceKey <= expired) throw new Failure('expired_key');
  // Project only bounded rows: SQL constraints cap both stored JSON columns.
  const existing = db.prepare(`SELECT canonical_json,event_json FROM event_spool
    WHERE attempt_id=? AND generation=? AND source=? AND source_key=?`)
    .get(row.attempt_id, row.generation, input.source, input.sourceKey);
  if (existing) {
    if (existing.canonical_json !== input.canonical) throw new Failure('conflict');
    return JSON.parse(existing.event_json as string) as AgentEvent;
  }
  if (input.sourceKey <= high) throw new Failure('expired_key');
  if (row.last_seq >= Number.MAX_SAFE_INTEGER - 1) throw new Failure('quota_exceeded');
  const { event, json } = encodedEvent(row, input);
  const projection = project(row, event);
  const bytes = Buffer.byteLength(json);
  const charge = bytes + Buffer.byteLength(input.canonical) + 256;
  if (row.spool_rows >= 65_536 || row.spool_bytes + charge + projection.snapshot_bytes > row.quota_bytes) throw new Failure('quota_exceeded');
  db.prepare(`INSERT INTO event_spool
    (attempt_id,generation,seq,source,source_key,canonical_json,event_json,encoded_bytes,charged_bytes)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(row.attempt_id, row.generation, event.seq,
    input.source, input.sourceKey, input.canonical, json, bytes, charge);
  db.prepare(`UPDATE accepted_attempts SET last_seq=?, spool_bytes=spool_bytes+?,
    spool_rows=spool_rows+1, ${counter}=?, state=?, phase=?, exit_json=?, exit_facts_json=?, result_json=?, snapshot_bytes=? WHERE id=?`)
    .run(event.seq, charge, input.sourceKey, projection.state, projection.phase,
      projection.exit_json, projection.exit_facts_json, projection.result_json, projection.snapshot_bytes, row.id);
  return event as AgentEvent;
}

function encodedEvent(row: Row, input: EventInput): { event: AgentEvent; json: string } {
  const original = JSON.parse(input.json) as ControlEvent | AgentEvent;
  if (original.kind === 'engine.result' &&
    JSON.stringify(eventKey(original.payload)) !== JSON.stringify(input.key)) throw new Failure('conflict');
  const event = { ...original, attemptId: row.attempt_id, organizationId: row.organization_id,
    workspaceId: row.workspace_id, generation: row.generation, seq: row.last_seq + 1,
    source: input.source, ...(input.source === 'wrapper' ? { wrapperSeq: input.sourceKey } : {}) };
  let json: string;
  try { json = encodeJson(event, MAX_EVENT_BYTES); } catch { throw new Failure('invalid_input'); }
  if (!validate('AgentEvent', event).ok) throw new Failure('invalid_input');
  return { event: event as AgentEvent, json };
}

function sourceCounters(row: Row, source: EventInput['source']) {
  return source === 'wrapper' ? { expired: row.wrapper_expired, high: row.wrapper_high, counter: 'wrapper_high' } :
    { expired: row.supervisor_expired, high: row.supervisor_high, counter: 'supervisor_high' };
}
