import type { AttemptAdmission } from '@beetle/contracts';
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { encodeCanonicalJson, estimateStaging, validate } from '@beetle/contracts';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { executionRegistryDigest } from '../../src/adapters/outbound/sqlite/execution-intents.js';
import { runCommand, runOptions } from './runs-fixture.js';
import { seedFoundation, enqueue, reserveAndMark, acknowledge, snapshotFor } from './execution-foundation-fixtures.js';
import { uuid } from './fixture.js';
it('persists immutable compact original costs, canonical registry and replay bytes', () => {
  const db = initialize(':memory:');
  try {
    const store = seedFoundation(db); const command = runCommand(uuid(60));
    const first = store.execute({ kind: 'run', command });
    const attempt = db.prepare('SELECT offer_json,registry_json FROM attempts').get()!;
    const offer = JSON.parse(String(attempt.offer_json)); const staging = estimateStaging(offer);
    const pin = runOptions().runs!.profiles[0]!;
    const digest = createHash('sha256').update('beetle-lab.execution-registry.v1').update(Uint8Array.of(10)).update(encodeCanonicalJson(pin, 32768)).digest('hex');
    expect(executionRegistryDigest(pin)).toBe(digest);
    const summary = db.prepare('SELECT * FROM execution_intents').get()!;
    expect(summary).toMatchObject({ queue_order: 1, attempt_id: offer.attemptId, profile_alias: 'standard', registry_digest: digest,
      cpu_millis: offer.budget.cpuMillis, output_bytes: offer.budget.outputBytes, staging_policy: 1,
      offer_bytes: staging.offerBytes, input_bytes: staging.inputBytes, secret_bytes: staging.secretBytes,
      manifest_bytes: staging.manifestBytes, metadata_bytes: staging.metadataBytes, staging_bytes: staging.totalBytes });
    const bytes = db.prepare('SELECT * FROM receipts').all();
    expect(store.execute({ kind: 'run', command })).toEqual(first);
    expect(db.prepare('SELECT offer_json,registry_json FROM attempts').get()).toEqual(attempt);
    expect(db.prepare('SELECT * FROM receipts').all()).toEqual(bytes);
    for (const table of ['execution_intents', 'dispatch_outbox']) expect(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`)).toThrow();
    expect(() => db.exec('UPDATE execution_intents SET cpu_millis=1')).toThrow();
    expect(() => db.exec('DELETE FROM execution_intents')).toThrow();
  } finally { db.close(); }
});
it('rolls back summary, run, attempt and receipt after a late outbox failure', () => {
  const db = initialize(':memory:');
  try {
    const store = seedFoundation(db); const before = db.prepare('SELECT * FROM receipts').all();
    db.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON dispatch_outbox BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    expect(() => enqueue(db, store)).toThrow();
    for (const table of ['execution_intents', 'runs', 'attempts', 'dispatch_outbox']) expect(db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n).toBe(0);
    expect(db.prepare('SELECT * FROM receipts').all()).toEqual(before);
  } finally { db.close(); }
});
it('accepts matched final admission only for execution release and retains output charge', () => {
  const db = initialize(':memory:');
  try {
    const { key, offer } = enqueue(db, seedFoundation(db)); transaction(db, () => reserveAndMark(db, key));
    expect(() => db.exec('UPDATE execution_records SET execution_charged=0')).toThrow();
    transaction(db, () => acknowledge(db, key, snapshotFor(key, { state: 'lost' })));
    expect(() => db.exec('UPDATE execution_records SET execution_charged=0')).toThrow();
    const final = snapshotFor(key, { state: 'lost', lastSeq: 2, admission: { state: 'released', disposition: 'settled' } });
    db.prepare('UPDATE execution_records SET snapshot_json=?,execution_charged=0').run(JSON.stringify(final));
    expect(() => db.exec('UPDATE execution_records SET execution_charged=1')).toThrow();
    const retained = db.prepare('SELECT snapshot_json FROM execution_records').get();
    const state = db.prepare('SELECT state FROM attempts').get();
    expect(() => transaction(db, () => {
      db.exec("UPDATE attempts SET state='lost'");
      db.prepare('UPDATE execution_records SET snapshot_json=?').run(JSON.stringify(snapshotFor(key, { state: 'lost', lastSeq: 3 })));
    })).toThrow();
    expect(db.prepare('SELECT snapshot_json FROM execution_records').get()).toEqual(retained);
    expect(db.prepare('SELECT state FROM attempts').get()).toEqual(state);
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(offer.budget.outputBytes + 65536);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

const finalProofChanges: { original: AttemptAdmission; replacement: AttemptAdmission }[] = [
  { original: { state: 'released', disposition: 'settled' }, replacement: { state: 'released', disposition: 'never_started' } },
  { original: { state: 'released', disposition: 'settled' }, replacement: { state: 'rejected', reason: 'cancelled' } },
  { original: { state: 'rejected', reason: 'cancelled' }, replacement: { state: 'rejected', reason: 'controls_unavailable' } },
  { original: { state: 'rejected', reason: 'cancelled' }, replacement: { state: 'released', disposition: 'never_started' } },
];
const finalProofCases = finalProofChanges.flatMap(change => [0, 1].map(charged => ({ ...change, charged })));
it.each(finalProofCases)('retains original final admission $original against $replacement (charge$charged)', ({ original, replacement, charged }) => {
  const db = initialize(':memory:');
  try {
    const { key, offer } = enqueue(db, seedFoundation(db));
    transaction(db, () => reserveAndMark(db, key));
    const first = snapshotFor(key, { lastSeq: 2, admission: original });
    expect(validate('AttemptSnapshot', first).ok).toBe(true);
    transaction(db, () => acknowledge(db, key, first));
    if (charged === 0) db.exec('UPDATE execution_records SET execution_charged=0');
    const retained = db.prepare('SELECT * FROM execution_records').get();
    const contradictory = snapshotFor(key, { lastSeq: 3, admission: replacement });
    expect(validate('AttemptSnapshot', contradictory).ok).toBe(true);
    expect(() => transaction(db, () => {
      db.exec("UPDATE attempts SET state='lost'");
      db.prepare('UPDATE execution_records SET snapshot_json=?').run(JSON.stringify(contradictory));
    })).toThrow();
    expect(db.prepare('SELECT * FROM execution_records').get()).toEqual(retained);
    expect(db.prepare('SELECT state FROM attempts').get()?.state).toBe('offered');
    const enriched = snapshotFor(key, { lastSeq: 4, state: 'lost', phase: 'seal', cancelRequested: true, admission: original });
    expect(validate('AttemptSnapshot', enriched).ok).toBe(true);
    db.prepare('UPDATE execution_records SET snapshot_json=?').run(JSON.stringify(enriched));
    expect(JSON.parse(String(db.prepare('SELECT snapshot_json FROM execution_records').get()?.snapshot_json))).toEqual(enriched);
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(offer.budget.outputBytes + 65536);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
