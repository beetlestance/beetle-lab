import { EVENT_BATCH_COUNT, EVENT_MAX_RETAINED_ROWS, EVENT_RECORD_BYTES } from '../../../../ports/events.js';
import type { DatabaseSync } from 'node:sqlite';
import { validate } from '@beetle/contracts';
import { EventBatchError, expiryCoverage, prepareEventBatch } from '../../../../domain/events/index.js';
import type { PreparedEventBatch } from '../../../../domain/events/index.js';
import type { EventAckRequest, EventBinding, EventCursorState, EventIngestRequest, EventIngestResult,
  EventPage, EventProblem, EventProblemRequest, EventScan } from '../../../../ports/events.js';
import { transaction } from '../schema.js';
import { StorageError } from '../protocol.js';
import { captureEventOperation } from './wire.js';
import type { EventOperation } from './wire.js';
import { capturePreparedIngestReply } from './reply.js';
import type { EventValue } from './reply.js';
import { ensureCursor, ownedAllowance, readState, finalizedState } from './rows.js';
import { scanEvents } from './scan.js';
import { ackRequest, problemRequest } from './values.js';
export { captureEventOperation, eventOperation, eventReplyLimit, eventRequestLimit } from './wire.js';
export { captureEventReply } from './reply.js';
export type { EventOperation } from './wire.js';

/** Synchronous worker owner. Statements are prepared lazily after application migration. */
export class EventCustody {
  constructor(private readonly db: DatabaseSync, private readonly installation: string) {}
  execute(input: EventOperation): EventValue {
    let operation: EventOperation;
    try { operation = captureEventOperation(input); } catch { throw new StorageError('invalid_input'); }
    try { return this.apply(operation); }
    catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError(error instanceof EventBatchError ? 'invalid_input' : 'unavailable');
    }
  }
  private apply(operation: EventOperation): EventValue {
    switch (operation.kind) {
      case 'eventScan': return this.scan(operation.query);
      case 'eventLoad': return this.load(operation.binding);
      case 'eventIngest': return this.ingest(operation.request);
      case 'eventConfirmAck': return this.confirmAck(operation.request);
      case 'eventProblem': return this.recordProblem(operation.request);
    }
  }
  scan(query: EventScan): EventPage { return scanEvents(this.db, this.installation, query); }
  load(binding: EventBinding): EventCursorState {
    return transaction(this.db, () => { ensureCursor(this.db, binding); return readState(this.db, binding); });
  }
  ingest(request: EventIngestRequest): EventIngestResult {
    const batch = prepareEventBatch(request);
    const result = transaction(this.db, () => {
      const value = this.append(batch);
      return typeof value === 'string' ? value : this.ingestReply(batch, value);
    });
    if (typeof result !== 'string') return result;
    return transaction(this.db, () => {
      const state = this.problem({ binding: batch.binding, after: batch.after, kind: result });
      return this.ingestReply(batch, { state, inserted: 0, ackThrough: state.durableThrough });
    });
  }
  private append(batch: PreparedEventBatch): EventIngestResult | EventProblem {
    const allowance = ownedAllowance(this.db, batch.binding);
    const state = readState(this.db, batch.binding, true);
    if (batch.after > state.durableThrough) throw new StorageError('invalid_input');
    if (state.blockedReason !== null) return { state, inserted: 0, ackThrough: state.durableThrough };
    const conflict = this.replayConflict(batch, state.durableThrough);
    if (conflict) return 'replay_conflict';
    const suffix = batch.records.filter(record => record.seq > state.durableThrough);
    const bytes = suffix.reduce((sum, record) => sum + record.chargedBytes, state.retainedBytes);
    if (state.eventCount + suffix.length > EVENT_MAX_RETAINED_ROWS || bytes > allowance) return 'quota_exhausted';
    ensureCursor(this.db, batch.binding);
    const insert = this.db.prepare(`INSERT INTO run_events(attempt_id,generation,seq,canonical_json,charged_bytes,cumulative_bytes)
      VALUES (?,?,?,?,?,?)`);
    let cumulative = state.retainedBytes;
    for (const record of suffix) {
      cumulative += record.chargedBytes;
      insert.run(batch.binding.key.attempt.attemptId, 1, record.seq, record.canonical, record.chargedBytes, cumulative);
    }
    return { state: readState(this.db, batch.binding), inserted: suffix.length,
      ackThrough: Math.max(state.durableThrough, batch.nextCursor) };
  }
  private ingestReply(batch: PreparedEventBatch, result: EventIngestResult): EventIngestResult {
    try { return capturePreparedIngestReply(batch, result); }
    catch { throw new StorageError('unavailable'); }
  }
  private replayConflict(batch: PreparedEventBatch, durable: number): boolean {
    const through = Math.min(durable, batch.nextCursor);
    if (through <= batch.after) return false;
    const rows = this.db.prepare(`SELECT seq,CASE WHEN length(CAST(canonical_json AS BLOB))<=${EVENT_RECORD_BYTES} THEN canonical_json
      ELSE NULL END canonical_json FROM run_events WHERE attempt_id=? AND generation=1 AND seq>? AND seq<=? ORDER BY seq LIMIT ${EVENT_BATCH_COUNT}`)
      .all(batch.binding.key.attempt.attemptId, batch.after, through);
    if (rows.length !== through - batch.after) throw new StorageError('unavailable');
    return rows.some((row, index) => {
      if (typeof row.canonical_json !== 'string' || row.seq !== batch.after + index + 1) throw new StorageError('unavailable');
      return row.canonical_json !== batch.records[index]!.canonical;
    });
  }
  confirmAck(request: EventAckRequest): EventCursorState {
    ackRequest(request);
    return transaction(this.db, () => {
      const finalized = finalizedState(this.db, request.binding);
      if (finalized) {
        const receipt = validate('AckReceipt', request.receipt);
        if (!receipt.ok || receipt.value.acknowledgedSeq !== finalized.durableThrough) throw new StorageError('invalid_input');
        return finalized;
      }
      ensureCursor(this.db, request.binding);
      const state = readState(this.db, request.binding);
      const receipt = validate('AckReceipt', request.receipt);
      if (!receipt.ok || receipt.value.acknowledgedSeq > state.durableThrough) throw new StorageError('invalid_input');
      this.db.prepare('UPDATE event_cursors SET ack_confirmed_through=max(ack_confirmed_through,?) WHERE attempt_id=?')
        .run(receipt.value.acknowledgedSeq, request.binding.key.attempt.attemptId);
      return readState(this.db, request.binding);
    });
  }
  recordProblem(request: EventProblemRequest): EventCursorState {
    problemRequest(request);
    return transaction(this.db, () => this.problem(request));
  }
  private problem(request: EventProblemRequest): EventCursorState {
    ensureCursor(this.db, request.binding);
    const state = readState(this.db, request.binding);
    if (request.after > state.durableThrough) throw new StorageError('invalid_input');
    if (request.kind === 'cursor_expired'
      && expiryCoverage(request.after, request.retainedStartSeq!, state.durableThrough) === 'covered') return state;
    if (state.blockedReason !== null) return state;
    this.db.prepare(`UPDATE event_cursors SET blocked_reason=?,coverage=?,retained_start_seq=? WHERE attempt_id=?`)
      .run(request.kind, request.kind === 'cursor_expired' ? 'partial' : 'contiguous', request.retainedStartSeq ?? null,
        request.binding.key.attempt.attemptId);
    return readState(this.db, request.binding);
  }
}
