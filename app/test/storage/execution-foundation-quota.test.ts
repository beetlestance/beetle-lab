import {rawConnection} from './raw-connection-fixture.js';
import { BACKEND_CLEANUP_CONTROL_BYTES } from '../../src/ports/cleanup-control.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { observation } from './fixture.js';
import { runOptions } from './runs-fixture.js';
import { expect, it } from 'vitest';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { reserveRunOutput } from '../../src/adapters/outbound/sqlite/output-reservations.js';
import { createInput as inputCommand } from './inputs-fixture.js';
import { seedFoundation, enqueue, insertRecord, reserveAndMark } from './execution-foundation-fixtures.js';
import { settingsFixture } from './fixture.js';
it('shares actual input/output usage and enforces exact reserve/overflow boundaries', () => {
  const db = initialize(':memory:');
  try {
    const store = seedFoundation(db,200000+BACKEND_CLEANUP_CONTROL_BYTES); const { key, offer } = enqueue(db, store); const charge = offer.budget.outputBytes + 65536 + BACKEND_CLEANUP_CONTROL_BYTES;
    for (const capacity of [{ allocationBytes: charge, reserveBytes: 1 }, { allocationBytes: Number.MAX_SAFE_INTEGER + 1, reserveBytes: 0 }, { allocationBytes: charge, reserveBytes: -1 }]) {
      expect(() => transaction(db, () => { insertRecord(db, key); reserveRunOutput(db, key, capacity); })).toThrow();
      expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(BACKEND_CLEANUP_CONTROL_BYTES);
    }
    transaction(db, () => {
      insertRecord(db, key); reserveRunOutput(db, key, { allocationBytes: charge + 1000, reserveBytes: 1000 });
      db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='synthetic'");
    });
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(charge);
    const next = enqueue(db, store, 71);
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(charge + BACKEND_CLEANUP_CONTROL_BYTES);
    const forged = { allocationBytes: charge, reserveBytes: 0, chargedBytes: 0 };
    expect(() => transaction(db, () => { insertRecord(db, next.key); reserveRunOutput(db, next.key, forged); })).toThrow();
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(charge + BACKEND_CLEANUP_CONTROL_BYTES);
    expect(() => db.exec('UPDATE installation_storage_usage SET charged_bytes=-1')).toThrow();
    expect(() => db.exec('UPDATE installation_storage_usage SET charged_bytes=9007199254740992')).toThrow();
  } finally { db.close(); }
});
it.each(['input-first', 'output-first'])('serializes competing real input and output reservations (%s)', order => {
  const db = initialize(':memory:');
  try {
    const store = seedFoundation(db,200000+BACKEND_CLEANUP_CONTROL_BYTES); const { key, offer } = enqueue(db, store);
    const pool = { ...settingsFixture().chain.installation.values.pool, storageBytes: 200000+BACKEND_CLEANUP_CONTROL_BYTES };
    // Fill the configured pool except for one payload+metadata charge shared by both contenders.
    const charge = offer.budget.outputBytes + 65536 + BACKEND_CLEANUP_CONTROL_BYTES;
    const initial = pool.storageBytes - pool.freeSpaceReserveBytes - charge;
    store.execute({ kind: 'input', command: inputCommand(801, initial - 65536) });
    const input = inputCommand(800, offer.budget.outputBytes);
    const createInput = () => store.execute({ kind: 'input', command: input });
    const createOutput = () => transaction(db, () => reserveAndMark(db, key, pool.storageBytes));
    if (order === 'input-first') { createInput(); expect(createOutput).toThrow(); }
    else { createOutput(); expect(createInput).toThrow(); }
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(initial + charge);
  } finally { db.close(); }
});

it('serializes two SQLite connections contending for the last shared allowance', () => {
  const root = mkdtempSync(join(tmpdir(), 'beetle-execution-quota-'));
  const path = join(root, 'quota.sqlite');
  let first = initialize(path); const store = seedFoundation(first,200000+BACKEND_CLEANUP_CONTROL_BYTES);
  const { key, offer } = enqueue(first, store); const charge = offer.budget.outputBytes + 65536 + BACKEND_CLEANUP_CONTROL_BYTES;
  store.execute({ kind: 'input', command: inputCommand(801, 200000 + BACKEND_CLEANUP_CONTROL_BYTES - 1000 - charge - 65536) });
  first.close(); first = rawConnection(path);
  const second = rawConnection(path);
  try {
    const fixture = settingsFixture(); fixture.runtime.pool.storageBytes = 400000;
    const contender = new Store(second, { installation: fixture.chain.installation, runtime: observation(fixture.runtime), ...runOptions() });
    const input = inputCommand(802, offer.budget.outputBytes);
    first.exec('BEGIN IMMEDIATE'); reserveAndMark(first, key, 200000+BACKEND_CLEANUP_CONTROL_BYTES);
    expect(() => contender.execute({ kind: 'input', command: input })).toThrow(/database is locked/);
    expect(second.isTransaction).toBe(false);
    first.exec('COMMIT');
    expect(() => contender.execute({ kind: 'input', command: input })).toThrow('Capacity unavailable');
    expect(second.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(199000+BACKEND_CLEANUP_CONTROL_BYTES);
    expect(second.prepare('SELECT count(*) n FROM input_blobs').get()?.n).toBe(1);
    expect(second.prepare('SELECT count(*) n FROM attempt_output_allocations').get()?.n).toBe(1);
  } finally { first.close(); second.close(); rmSync(root, { recursive: true, force: true }); }
});
