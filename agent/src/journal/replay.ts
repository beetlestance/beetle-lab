import { snapshot } from './snapshot.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Ack, AckReceipt, AgentEvent, EventBatch } from '@beetle/contracts';
import { MAX_BATCH_BYTES } from './event-input.js';
import type { GenerationKey, PruneReceipt } from './protocol.js';
import { Failure, owner, transaction } from './sql.js';

interface LengthRow { seq: number; encoded_bytes: number }
interface PruneRow { seq: number; source: 'wrapper' | 'agent'; source_key: number; charged_bytes: number }
export function readEvents(db: DatabaseSync, key: GenerationKey, after: number): EventBatch {
  const row = owner(db, key);
  if (after < row.retained_start_seq - 1) throw new Failure('cursor_expired', snapshot(db, row));
  if (after > row.last_seq) throw new Failure('invalid_input');
  const batch: EventBatch = { protocolVersion: '1.0', organizationId: row.organization_id,
    workspaceId: row.workspace_id, attemptId: row.attempt_id, generation: row.generation,
    events: [], nextCursor: after, retainedStartSeq: row.retained_start_seq };
  // Reserve cursor digit growth and commas before selecting payloads. At most 100
  // scalar length rows are read, then only the chosen <=256 KiB JSON payloads.
  let remaining = MAX_BATCH_BYTES - Buffer.byteLength(JSON.stringify(batch)) - 32;
  const lengths = db.prepare(`SELECT seq,encoded_bytes FROM event_spool
    WHERE attempt_id=? AND generation=? AND seq>? ORDER BY seq LIMIT 100`)
    .all(row.attempt_id, row.generation, after) as unknown as LengthRow[];
  let through = after;
  for (const event of lengths) {
    if (event.encoded_bytes + 1 > remaining) break;
    remaining -= event.encoded_bytes + 1; through = event.seq;
  }
  const payloads = db.prepare(`SELECT event_json FROM event_spool
    WHERE attempt_id=? AND generation=? AND seq>? AND seq<=? ORDER BY seq LIMIT 100`)
    .all(row.attempt_id, row.generation, after, through);
  batch.events = payloads.map(value => JSON.parse(value.event_json as string) as AgentEvent);
  batch.nextCursor = through;
  return batch;
}
export function acknowledge(db: DatabaseSync, ack: Ack): AckReceipt {
  return transaction(db, () => {
    const row = owner(db, ack);
    if (ack.throughSeq > row.last_seq) throw new Failure('invalid_input');
    const acknowledgedSeq = Math.max(row.acknowledged_seq, ack.throughSeq);
    db.prepare('UPDATE accepted_attempts SET acknowledged_seq=? WHERE id=?').run(acknowledgedSeq, row.id);
    return { protocolVersion: '1.0', organizationId: row.organization_id, workspaceId: row.workspace_id,
      attemptId: row.attempt_id, generation: row.generation, acknowledgedSeq };
  });
}
export function prune(db: DatabaseSync, key: GenerationKey): PruneReceipt {
  return transaction(db, () => {
    const row = owner(db, key);
    const rows = db.prepare(`SELECT seq,source,source_key,charged_bytes FROM event_spool
      WHERE attempt_id=? AND generation=? AND seq<=? ORDER BY seq LIMIT 100`)
      .all(row.attempt_id, row.generation, row.acknowledged_seq) as unknown as PruneRow[];
    let bytes = 0; let wrapper = row.wrapper_expired; let supervisor = row.supervisor_expired;
    for (const event of rows) {
      bytes += event.charged_bytes;
      if (event.source === 'wrapper') wrapper = Math.max(wrapper, event.source_key);
      else supervisor = Math.max(supervisor, event.source_key);
    }
    const through = rows.at(-1)?.seq;
    if (through !== undefined) {
      db.prepare('DELETE FROM event_spool WHERE attempt_id=? AND generation=? AND seq<=?')
        .run(row.attempt_id, row.generation, through);
      db.prepare(`UPDATE accepted_attempts SET retained_start_seq=?, spool_bytes=spool_bytes-?,
        spool_rows=spool_rows-?, wrapper_expired=?, supervisor_expired=? WHERE id=?`)
        .run(through + 1, bytes, rows.length, wrapper, supervisor, row.id);
    }
    return { pruned: rows.length, snapshot: snapshot(db, owner(db, key)) };
  });
}
