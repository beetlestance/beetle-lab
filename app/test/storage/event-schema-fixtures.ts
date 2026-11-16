import { afterEach } from 'vitest';
import type { EventBatch } from '@beetle/contracts';
import type { EventBinding } from '../../src/domain/events/index.js';
import { prepareEventBatch } from '../../src/domain/events/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { reserveRunOutput } from '../../src/adapters/outbound/sqlite/output-reservations.js';
import { claimsFixture } from './dispatch-claim-fixtures.js';
import { acknowledge, reserveAndMark } from './execution-foundation-fixtures.js';
import batch from '../../../contracts/fixtures/valid/events.json' with { type: 'json' };

const handles = new Set<ReturnType<typeof claimsFixture>>();
afterEach(() => { for (const f of handles) f.db.close(); handles.clear(); });
export function eventSchemaFixture(output = 1000, ack = true, pending?: number) {
  const f = claimsFixture(); handles.add(f);
  const key = f.add(70, 'parallel', 100, output);
  transaction(f.db, () => {
    if (pending === undefined) reserveAndMark(f.db, key);
    else {
      f.db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        delivery_attempt_id,output_attempt_id,journal_authority,event_pending)
        SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,attempt_id,attempt_id,
        '33333333-3333-4333-8333-333333333333',? FROM execution_intents WHERE attempt_id=?`).run(pending, key.attempt.attemptId);
      reserveRunOutput(f.db, key, { allocationBytes: Number.MAX_SAFE_INTEGER, reserveBytes: 0 });
      f.db.prepare("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00.000Z' WHERE attempt_id=?")
        .run(key.attempt.attemptId);
    }
    if (ack) acknowledge(f.db, key);
  });
  const binding: EventBinding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  const args = [key.attempt.attemptId, key.runId, key.attempt.organizationId, key.attempt.workspaceId,
    key.attempt.intentDigest, binding.journalAuthority, 1];
  function create(patch: Record<string, unknown> = {}) {
    const row = { attempt_id: args[0], run_id: args[1], organization_id: args[2], workspace_id: args[3],
      intent_digest: args[4], journal_authority: args[5], generation: args[6], ...patch };
    const columns = Object.keys(row);
    f.db.prepare(`INSERT INTO event_cursors(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .run(...Object.values(row) as (string | number | null)[]);
  }
  function event(seq = 1) {
    const source = (structuredClone(batch) as EventBatch).events.find(value => value.kind === 'runtime.started')!;
    const current = { ...source, organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId,
      attemptId: key.attempt.attemptId, generation: 1, seq, payload: { runtimeId: 'r' } };
    return prepareEventBatch({ binding, after: seq - 1,
      batch: { ...batch, organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId,
        attemptId: key.attempt.attemptId, events: [current], nextCursor: seq } }).records[0]!;
  }
  function append(seq = 1) {
    const record = event(seq);
    const previous = Number(f.db.prepare('SELECT retained_bytes FROM event_cursors WHERE attempt_id=?').get(key.attempt.attemptId)?.retained_bytes);
    f.db.prepare(`INSERT INTO run_events(attempt_id,generation,seq,canonical_json,charged_bytes,cumulative_bytes)
      VALUES (?,1,?,?,?,?)`).run(key.attempt.attemptId, seq, record.canonical, record.chargedBytes, previous + record.chargedBytes);
    return record;
  }
  const cursor = () => f.db.prepare('SELECT * FROM event_cursors WHERE attempt_id=?').get(key.attempt.attemptId)!;
  return { ...f, binding, args, create, event, append, cursor };
}
