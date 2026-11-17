import {
  captureEventLength,
  capturePruneEvent,
  captureStoredEvent,
  eventLengthColumns,
  pruneEventColumns,
  storedEventColumn,
} from './event-row.js';
import type { EventLengthRow } from './event-row.js';
import { sqlIntegerColumn } from './sql-columns.js';
import { snapshot } from './snapshot.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Ack, AckReceipt, EventBatch } from '@beetle/contracts';
import { MAX_BATCH_BYTES } from './event-input.js';
import type { GenerationKey, PruneReceipt } from './protocol.js';
import { Failure, owner, transaction } from './sql.js';

export function readEvents(db: DatabaseSync, key: GenerationKey, after: number): EventBatch {
  const row = owner(db, key);
  if (after < row.retained_start_seq - 1) throw new Failure('cursor_expired', snapshot(db, row));
  if (after > row.last_seq) throw new Failure('invalid_input');
  const batch: EventBatch = {
    protocolVersion: '1.0',
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    attemptId: row.attempt_id,
    generation: row.generation,
    events: [],
    nextCursor: after,
    retainedStartSeq: row.retained_start_seq,
  };
  // Reserve cursor digit growth and commas before selecting payloads. At most 100
  // scalar length rows are read, then only the chosen <=256 KiB JSON payloads.
  let remaining = MAX_BATCH_BYTES - Buffer.byteLength(JSON.stringify(batch)) - 32;
  const lengths = db
    .prepare(
      `SELECT ${eventLengthColumns} FROM event_spool
    WHERE attempt_id=? AND generation=? AND seq>? ORDER BY event_spool.seq LIMIT 100`,
    )
    .all(row.attempt_id, row.generation, after)
    .map(captureEventLength);
  if (lengths.some((event) => event.seq > row.last_seq)) throw new Failure('unavailable');
  requireContiguous(lengths, after + 1);
  if (!lengths.length && after < row.last_seq) throw new Failure('unavailable');
  let through = after;
  for (const event of lengths) {
    if (event.encoded_bytes + 1 > remaining) break;
    remaining -= event.encoded_bytes + 1;
    through = event.seq;
  }
  batch.events = readPayloads(
    db,
    key,
    after,
    lengths.filter((item) => item.seq <= through),
  );
  batch.nextCursor = through;
  return batch;
}
export function acknowledge(db: DatabaseSync, ack: Ack): AckReceipt {
  return transaction(db, () => {
    const row = owner(db, ack);
    if (ack.throughSeq > row.last_seq) throw new Failure('invalid_input');
    const acknowledgedSeq = Math.max(row.acknowledged_seq, ack.throughSeq);
    db.prepare('UPDATE accepted_attempts SET acknowledged_seq=? WHERE id=?').run(acknowledgedSeq, row.id);
    return {
      protocolVersion: '1.0',
      organizationId: row.organization_id,
      workspaceId: row.workspace_id,
      attemptId: row.attempt_id,
      generation: row.generation,
      acknowledgedSeq,
    };
  });
}
export function prune(db: DatabaseSync, key: GenerationKey): PruneReceipt {
  return transaction(db, () => {
    const row = owner(db, key);
    const rows = db
      .prepare(
        `SELECT ${pruneEventColumns} FROM event_spool
      WHERE attempt_id=? AND generation=? AND seq<=? ORDER BY event_spool.seq LIMIT 100`,
      )
      .all(row.attempt_id, row.generation, row.acknowledged_seq)
      .map((value) => capturePruneEvent(value, row));
    requireContiguous(rows, Math.max(1, row.retained_start_seq));
    if (!rows.length && row.acknowledged_seq >= Math.max(1, row.retained_start_seq)) throw new Failure('unavailable');
    let bytes = 0;
    let wrapper = row.wrapper_expired;
    let supervisor = row.supervisor_expired;
    for (const event of rows) {
      if (bytes > Number.MAX_SAFE_INTEGER - event.charged_bytes) throw new Failure('unavailable');
      bytes += event.charged_bytes;
      if (event.source === 'wrapper') wrapper = Math.max(wrapper, event.source_key);
      else supervisor = Math.max(supervisor, event.source_key);
    }
    const through = rows.at(-1)?.seq;
    if (through !== undefined) {
      db.prepare('DELETE FROM event_spool WHERE attempt_id=? AND generation=? AND seq<=?').run(
        row.attempt_id,
        row.generation,
        through,
      );
      db.prepare(
        `UPDATE accepted_attempts SET retained_start_seq=?, spool_bytes=spool_bytes-?,
        spool_rows=spool_rows-?, wrapper_expired=?, supervisor_expired=? WHERE id=?`,
      ).run(through + 1, bytes, rows.length, wrapper, supervisor, row.id);
    }
    return { pruned: rows.length, snapshot: snapshot(db, owner(db, key)) };
  });
}

function requireContiguous(rows: readonly EventLengthRow[], first: number): void {
  for (const [index, row] of rows.entries()) if (row.seq !== first + index) throw new Failure('unavailable');
}
function readPayloads(
  db: DatabaseSync,
  key: GenerationKey,
  after: number,
  selected: readonly EventLengthRow[],
): EventBatch['events'] {
  if (!selected.length) return [];
  const through = selected.at(-1)!.seq;
  const rows = db
    .prepare(
      `SELECT ${sqlIntegerColumn('seq')},${storedEventColumn} FROM event_spool
    WHERE attempt_id=? AND generation=? AND seq>? AND seq<=? ORDER BY event_spool.seq LIMIT 100`,
    )
    .all(key.attemptId, key.generation, after, through);
  if (rows.length !== selected.length) throw new Failure('unavailable');
  return rows.map((row, index) => {
    const expected = selected[index]!;
    if (
      row.seq !== expected.seq ||
      typeof row.event_json !== 'string' ||
      Buffer.byteLength(row.event_json) !== expected.encoded_bytes
    )
      throw new Failure('unavailable');
    return captureStoredEvent(row.event_json, key, expected.seq);
  });
}
