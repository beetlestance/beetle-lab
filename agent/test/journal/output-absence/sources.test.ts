import { expect, it } from 'vitest';
import { OUTPUT_REJECTION_REASONS } from '@beetle/contracts/output-source';
import { sourceFixture, json } from '../../source-journal/fixtures.js';
import { insert } from './fixtures.js';
import { scope, now } from '../../admission/fixtures.js';
import { initialize } from '../../../src/journal/schema.js';
import { Store } from '../../../src/journal/store.js';

const f = sourceFixture();

it('retains pending publication across close/reopen and refuses to relabel recovered collection as failed', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent);
  expect(await e.journal.closeOutputAbsence(e.key)).toBeNull();
  await f.close(e.journal); const journal = await f.open(e.path);
  expect(await journal.closeOutputAbsence(e.key)).toBeNull();
  await expect(journal.failOutputCollection(e.failed)).rejects.toMatchObject({ code: 'conflict' });
  expect(await journal.readOutputAbsence(e.key)).toBeNull();
  const receipt = await journal.commitOutputSource(e.collected); await journal.releaseOutputSource(receipt);
  expect(await journal.closeOutputAbsence(e.key)).toBeNull();
});

it('closes a current failed collection with validated physical witnesses and fences all later source work natively', async () => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
  e.op({ kind: 'outputCollectionFailed', json: json(e.failed) });
  const proof = e.store.execute({ id: 90, kind: 'outputAbsenceClose', key: e.key });
  expect(proof).toMatchObject({ admission: { state: 'released', disposition: 'settled' }, reason: 'artifact_incomplete', finalAgentSeq: 2 });
  expect(e.store.execute({ id: 91, kind: 'outputAbsenceClose', key: e.key })).toEqual(proof);
  for (const verb of ['INSERT', 'INSERT OR REPLACE', 'REPLACE']) {
    expect(() => e.db.prepare(`${verb} INTO output_sources(attempt_id,source_json,manifest_digest,source_digest,charged_bytes)
      VALUES(?,?,?,?,?)`).run(e.key.attemptId, json(e.source), e.source.manifest.manifestDigest, e.source.sourceDigest,
      Buffer.byteLength(json(e.source)) + 256)).toThrow();
    expect(() => e.db.prepare(`${verb} INTO output_collection_intents SELECT * FROM output_collection_intents`).run()).toThrow();
  }
  expect(() => e.db.exec("UPDATE output_collection_intents SET phase='pending'")).toThrow();
  expect(() => e.db.exec('DELETE FROM output_collection_intents')).toThrow();
});

it.each(['commit', 'absence'] as const)('serializes source publication versus absence with %s first and never fabricates absence', async first => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent);
  const operations = first === 'commit'
    ? [e.journal.commitOutputSource(e.collected), e.journal.closeOutputAbsence(e.key)]
    : [e.journal.closeOutputAbsence(e.key), e.journal.commitOutputSource(e.collected)];
  const results = await Promise.all(operations);
  expect(results[first === 'commit' ? 1 : 0]).toBeNull();
  const source = await e.journal.readOutputSource(e.key); expect(source).not.toBeNull();
  expect(await e.journal.readOutputAbsence(e.key)).toBeNull();
  await f.close(e.journal); const db = initialize(e.path);
  try {
    const proof = { version: 1 as const, ...e.key, generation: 1 as const, intentDigest: e.offer.intentDigest,
      journalAuthority: e.intent.binding.journalAuthority, finalAgentSeq: 2,
      admission: { state: 'released' as const, disposition: 'settled' as const }, reason: 'artifact_incomplete' as const };
    expect(() => insert(db, proof)).toThrow();
  } finally { db.close(); }
});

it('uses the shared mapping for every durable rejection, including zero-event closure', async () => {
  const path = f.path(); const journal = await f.configured(path);
  const cases = Object.entries(OUTPUT_REJECTION_REASONS);
  const offers = cases.map((_, index) => f.job(index + 1));
  for (const offer of offers) await f.enqueue(journal, offer, now);
  await f.close(journal); const db = initialize(path); const store = new Store(db);
  try {
    for (const [index, [reason, expected]] of cases.entries()) {
      const key = scope(offers[index]!);
      if (reason === 'cancelled') db.prepare('UPDATE accepted_attempts SET cancel_requested=1 WHERE attempt_id=?').run(key.attemptId);
      db.prepare('UPDATE admission_queue SET pending=0,decision_json=? WHERE attempt_id=?')
        .run(JSON.stringify({ kind: 'reject', reason }), key.attemptId);
      expect(store.execute({ id: index, kind: 'outputAbsenceClose', key }))
        .toMatchObject({ admission: { state: 'rejected', reason }, reason: expected, finalAgentSeq: 0 });
    }
  } finally { db.close(); }
});

it('independently rejects wrong physical release binding, unknown settlement and mistyped/outdated samples through native INSERT', async () => {
  const e = await f.native();
  e.store.execute({ id: 1, kind: 'admission', request: { kind: 'release', evidence: e.failed.evidence } });
  const original = e.db.prepare('SELECT reservation_json FROM reservations').get()?.reservation_json;
  if (typeof original !== 'string') throw new Error('Missing actual reservation');
  const proof = { version: 1 as const, ...e.key, generation: 1 as const, intentDigest: e.offer.intentDigest,
    journalAuthority: e.intent.binding.journalAuthority, finalAgentSeq: 2,
    admission: { state: 'released' as const, disposition: 'settled' as const }, reason: 'artifact_incomplete' as const };
  for (const [path, value] of [
    ['$.releaseEvidence.runtimeId', 'wrong-runtime'], ['$.releaseEvidence.launch.settlementId', 'wrong-settlement'],
    ['$.releaseEvidence.key.organizationId', '00000000-0000-4000-8000-000000000099'],
    ['$.launchSettlement.disposition', 'unknown'], ['$.releaseEvidence.runtime.observedAt', '999999999'],
    ['$.releaseEvidence.collection.observedAt', now],
  ] as const) {
    e.db.prepare('UPDATE reservations SET reservation_json=json_set(?,?,?)').run(original, path, value);
    expect(() => insert(e.db, proof)).toThrow();
    expect(() => e.store.execute({ id: 2, kind: 'outputAbsenceClose', key: e.key })).toThrow('unavailable');
    e.db.prepare('UPDATE reservations SET reservation_json=?').run(original);
  }
  expect(e.store.execute({ id: 3, kind: 'outputAbsenceClose', key: e.key })).toEqual(proof);
});
