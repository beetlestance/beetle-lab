import { expect, it } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { RunEvents } from '../../src/adapters/outbound/sqlite/run-events/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { reserveAndMark, acknowledge } from '../storage/execution-foundation-fixtures.js';
import { large, grow } from '../storage/events/large-fixtures.js';
import { observation, settingsFixture } from '../storage/fixture.js';
import { fixture, guardsOff } from './fixture.js';

it('admits cumulative charges before bodies and keeps a full page bounded with forward progress', () => {
  const f = fixture();
  f.policy(values => { values.pool.outputBytes = 2000000; values.pool.storageBytes = 8000000; values.perRunCeilings.outputBytes = 1000000; });
  const runtime = observation(settingsFixture().runtime);
  runtime.ceilings.pool.outputBytes = 2000000; runtime.ceilings.perRun.outputBytes = 1000000;
  runtime.ceilings.pool.storageBytes = 8000000;
  f.store.execute({ kind: 'runtime', runtime });
  const key = f.add(74, 'parallel', 100, 1000000);
  transaction(f.db, () => { reserveAndMark(f.db, key); acknowledge(f.db, key); });
  const binding = { key, journalAuthority: f.binding.journalAuthority };
  const batch = large(binding, 1); grow(batch, 65536, true);
  for (let seq = 1; seq <= 5; seq++) {
    const event = { ...batch.events[0]!, seq };
    expect(f.events.ingest({ binding, after: seq - 1, batch: { ...batch, nextCursor: seq, events: [event] } }).inserted).toBe(1);
  }
  const reader = new RunEvents(f.db, f.reads); const query = { ...f.query, id: key.runId };
  const page = reader.get(query);
  expect(page.items).toHaveLength(3); expect(page.nextCursor).toBe(page.resumeCursor);
  expect(Buffer.byteLength(encodeJson(page, 262144))).toBeLessThanOrEqual(262144);
  expect(reader.get({ ...query, cursor: page.resumeCursor }).items).toHaveLength(2);
  // A non-admitted body is not parsed on the first page; its own page fails closed.
  guardsOff(f.db, 'run_events');
  const corrupt = '{}' + ' '.repeat(65534);
  f.db.prepare('UPDATE run_events SET canonical_json=? WHERE attempt_id=? AND seq=4').run(corrupt, key.attempt.attemptId);
  expect(reader.get(query)).toEqual(page);
  expect(() => reader.get({ ...query, cursor: page.resumeCursor })).toThrow(expect.objectContaining({ code: 'unavailable' }));
});
