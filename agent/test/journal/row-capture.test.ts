import resultFixture from '../../../contracts/fixtures/valid/passed-result.json' with {type:'json'};
import { beforeAll, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { captureAttemptRow } from '../../src/journal/attempt-row.js';
import type { Row } from '../../src/journal/attempt-row.js';
import { servingColumns, owner } from '../../src/journal/sql.js';
import { captureStoredOffer } from '../../src/journal/stored-offer.js';
import { captureClockRow } from '../../src/journal/clock-row.js';
import { captureRunnableRows } from '../../src/journal/runnable-row.js';
import {
  captureEventLength,
  capturePruneEvent,
  captureStoredEvent,
  captureSourceReplay,
} from '../../src/journal/event-row.js';
import { EVENT_ROW_OVERHEAD_BYTES, eventInput } from '../../src/journal/event-input.js';
import { offerInput } from '../../src/journal/input.js';
import { journalFixture } from './fixtures.js';
const f = journalFixture();
let base: Row;
beforeAll(async () => {
  const path = f.path();
  const journal = await f.open(path);
  await journal.immutableOffer(f.offer());
  await f.close(journal);
  const db = new DatabaseSync(path);
  try {
    base = captureAttemptRow(db.prepare(`SELECT ${servingColumns} FROM accepted_attempts`).get());
  } finally {
    db.close();
  }
});
it('captures a real SQLite attempt without changing its immutable fields', () => {
  expect(captureAttemptRow(base)).toEqual(base);
});
it.each([
  { id: 0 },
  { generation: 2 },
  { attempt_id: 'invalid' },
  { intent_digest: 'invalid' },
  { state: 'unknown' },
  { cancel_requested: 2 },
  { delivery_pending: 2 },
  { absence_pending: '0' },
  { cleanup_control_version: 2 },
  { spool_bytes: '0' },
  { snapshot_bytes: 1.5 },
  { acknowledged_seq: 1 },
  { retained_start_seq: 2 },
  { wrapper_expired: 1 },
  { execution_purpose: 'unknown' },
  { staging_namespace_identity: 'invalid' },
  { exit_json: 'null' },
  { exit_facts_json: '{}' },
  { result_json: '{}' },
  { export_result_json: '{}' },
  { wrapper_checkpoint_json: 'null' },
])('refuses corrupt attempt data %j', (amendment) => {
  expect(() => captureAttemptRow({ ...base, ...amendment })).toThrowError();
});
it('preserves valid UUID URN spelling', () => {
  const id = 'URN:UUID:ABCDEFAB-0000-4000-8000-000000000001';
  expect(captureAttemptRow({ ...base, attempt_id: id }).attempt_id).toBe(id);
});
it('refuses wrong stored JSON/number cell types through the actual owner SQL read', () => {
  const db = new DatabaseSync(':memory:');
  const stored = { ...base, exit_json: 'X'.repeat(1000000), snapshot_bytes: Buffer.alloc(1000000) };
  try {
    const keys = Object.keys(stored);
    db.exec(`CREATE TABLE accepted_attempts(${keys.join(',')})`);
    db.prepare(`INSERT INTO accepted_attempts VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(stored));
    const selected = db.prepare(`SELECT ${servingColumns} FROM accepted_attempts`).get();
    expect(selected?.exit_json).toBe('');
    expect(selected?.snapshot_bytes).toBeNull();
    expect(() => owner(db, f.key())).toThrowError();
  } finally {
    db.close();
  }
});
it('validates saved Offer shape, scope, immutable digest and canonical content', () => {
  const offer = f.offer();
  const saved = offerInput(offer);
  expect(captureStoredOffer(saved.json, saved.canonical, base)).toEqual(offer);
  expect(() => captureStoredOffer('null', saved.canonical, base)).toThrowError();
  expect(() => captureStoredOffer(Buffer.from(saved.json), saved.canonical, base)).toThrowError();
  expect(() => captureStoredOffer(saved.json, '{}', base)).toThrowError();
  expect(() =>
    captureStoredOffer(JSON.stringify({ ...offer, intentDigest: 'b'.repeat(64) }), saved.canonical, base),
  ).toThrowError();
});
it.each([
  { high_water: -1 },
  { high_water: 1.5 },
  { fenced: 2 },
  { stop_immediate: '0' },
  { cancel_at: 101 },
  { cancel_at: '0' },
  { cancel_reason: 'unknown' },
])('refuses corrupt clock facts %j', (amendment) => {
  expect(() =>
    captureClockRow({
      high_water: 100,
      fenced: 0,
      cancel_at: null,
      cancel_reason: null,
      stop_immediate: 0,
      ...amendment,
    }),
  ).toThrowError();
});
it('preserves unanchored legacy cancellation facts and missing clock rows', () => {
  expect(captureClockRow(undefined)).toBeUndefined();
  expect(
    captureClockRow({ high_water: 100, fenced: 0, cancel_at: null, cancel_reason: null, stop_immediate: 0 })?.cancel_at,
  ).toBeNull();
});
it('captures every runnable overflow row and rejects invalid cursor order', () => {
  const first = {
    id: 1,
    attempt_id: base.attempt_id,
    organization_id: base.organization_id,
    workspace_id: base.workspace_id,
    generation: 1,
  };
  expect(captureRunnableRows([first], 0)).toEqual([first]);
  expect(() => captureRunnableRows([first, { ...first, id: 2, attempt_id: 'invalid' }], 0)).toThrowError();
  expect(() => captureRunnableRows([first, first], 0)).toThrowError();
  expect(() => captureRunnableRows([{ ...first, id: 3 }], 0, 2)).toThrowError();
  expect(() => captureRunnableRows([{ ...first, generation: 2 }], 0)).toThrowError();
});
it('refuses event length/accounting corruption rather than trusting scalar assertions', () => {
  const length = { seq: 1, encoded_bytes: 100, actual_bytes: 100 };
  expect(captureEventLength(length)).toEqual({ seq: 1, encoded_bytes: 100 });
  expect(() => captureEventLength({ ...length, encoded_bytes: 1 })).toThrowError();
  const record = {
    ...length,
    source: 'wrapper',
    source_key: 1,
    charged_bytes: 200 + EVENT_ROW_OVERHEAD_BYTES,
    canonical_bytes: 100,
  };
  expect(capturePruneEvent(record, { ...base, wrapper_high: 1 }).charged_bytes).toBe(200 + EVENT_ROW_OVERHEAD_BYTES);
  expect(() => capturePruneEvent({ ...record, charged_bytes: 200 }, { ...base, wrapper_high: 1 })).toThrowError();
  expect(() => capturePruneEvent({ ...record, source: 'unknown' }, { ...base, wrapper_high: 1 })).toThrowError();
  expect(() => capturePruneEvent({ ...record, source_key: 2 }, { ...base, wrapper_high: 1 })).toThrowError();
});
it('validates replayed event JSON and reconstructs wrapper/control canonical data', () => {
  const control = f.wrapper();
  const input = eventInput(control, 'wrapper');
  const event = { ...control, source: 'wrapper', seq: 1, wrapperSeq: control.seq };
  const json = JSON.stringify(event);
  const row = { ...base, last_seq: 1, wrapper_high: control.seq };
  expect(captureStoredEvent(json, f.key(), 1)).toEqual(event);
  expect(captureSourceReplay({ event_json: json, canonical_json: input.canonical }, row, input)).toEqual(event);
  expect(() => captureStoredEvent(json, f.key(), 2)).toThrowError();
  expect(() => captureStoredEvent('null', f.key())).toThrowError();
  expect(() =>
    captureStoredEvent(JSON.stringify({ ...event, workspaceId: '00000000-0000-4000-8000-000000000099' }), f.key()),
  ).toThrowError();
  expect(() => captureSourceReplay({ event_json: json, canonical_json: '{}' }, row, input)).toThrowError();
});

it('binds nested engine results to their durable attempt owner',()=>{
  const result={...structuredClone(resultFixture),...f.key()};
  expect(captureAttemptRow({...base,result_json:JSON.stringify(result)}).result_json).toBe(JSON.stringify(result));
  expect(()=>captureAttemptRow({...base,result_json:JSON.stringify({...result,workspaceId:'00000000-0000-4000-8000-000000000099'})})).toThrowError();
});
