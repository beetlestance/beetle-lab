import { DatabaseSync } from 'node:sqlite';
import { sealEngineResult } from '@beetle/contracts';
import { captureCollectionIntent } from '../../src/output-source/index.js';
import type { Journal } from '../../src/journal/index.js';
import { receiptForOutputSource } from '../../src/output-source/index.js';
import { outputParentGuards } from '../../src/journal/output-source-schema.js';
import { outputSourceGuards } from '../../src/journal/output-source-guards.js';
import { transaction } from '../../src/journal/sql.js';
import type { OutputDeliveryClosure, OutputDeliveryOperation } from '../../src/journal/output-delivery-protocol.js';
import { sourceFixture, hash, json, tables, rows, loseReply } from '../source-journal/fixtures.js';
import { configuration, now, observation, reserved, scope } from '../admission/fixtures.js';

export { hash, json, loseReply };
export const deliveryTriggers = ['delivery_parent_insert', 'delivery_insert', 'delivery_inserted',
  'delivery_update', 'delivery_delete', 'delivery_event_insert', 'delivery_event_update'];
export function durableRows(db: DatabaseSync) {
  return [...rows(db), { table: 'output_delivery_closures', rows: db.prepare('SELECT * FROM output_delivery_closures').all() }];
}
export function used(db: DatabaseSync): number {
  return Number(db.prepare(`SELECT spool_bytes+snapshot_bytes+checkpoint_bytes+hold_bytes+collection_bytes+source_bytes+delivery_bytes AS n
    FROM accepted_attempts`).get()?.n);
}
/** A real current source fixture transformed into precisely historical schema12, with FKs on. */
export function schema12(db: DatabaseSync): void {
  transaction(db, () => {
    if (db.prepare('SELECT COUNT(*) AS n FROM output_delivery_closures').get()?.n !== 0
      || db.prepare('SELECT COUNT(*) AS n FROM accepted_attempts WHERE delivery_bytes!=0').get()?.n !== 0) throw new Error('Closure must be absent');
    for (const name of deliveryTriggers) db.exec(`DROP TRIGGER ${name}`);
    db.exec('DROP TRIGGER output_parent_insert'); db.exec(outputParentGuards);
    const inserted = outputSourceGuards.match(/CREATE TRIGGER output_source_inserted[\s\S]+?END;/)?.[0];
    if (!inserted) throw new Error('Missing historical source trigger');
    db.exec(`DROP TRIGGER output_source_inserted; ${inserted}
      DROP INDEX output_delivery_pending; DROP TABLE output_delivery_closures;
      ALTER TABLE accepted_attempts DROP COLUMN delivery_pending; ALTER TABLE accepted_attempts DROP COLUMN delivery_bytes;
      PRAGMA user_version=12;`);
  });
}
export function deliveryFixture() {
  const f = sourceFixture();
  async function ready() {
    const e = await f.seed(); await e.journal.beginOutputCollection(e.intent);
    const receipt = await e.journal.commitOutputSource(e.collected); await e.journal.releaseOutputSource(receipt);
    return { ...e, receipt };
  }
  async function nativeReady() {
    const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
    e.op({ kind: 'outputSourceCommit', json: json(e.source) });
    const receipt = receiptForOutputSource(e.source, hash); e.op({ kind: 'outputSourceRelease', json: json(receipt) });
    return { ...e, receipt, delivery: (input: OutputDeliveryOperation) => e.store.execute({ ...input, id: 999 }),
      expected: { version: 1 as const, receipt, finalAgentSeq: Number(e.db.prepare('SELECT last_seq FROM accepted_attempts').get()?.last_seq) } };
  }
  /** Actual worker originals; the copied root/runtime facts remain explicitly synthetic. */
  async function next(journal: Journal, original: Awaited<ReturnType<typeof ready>>, id: number, release = true) {
    const offer = f.job(id); offer.budget.outputBytes = 100_000;
    const at = now + id * 10;
    // Four genuine retained originals need explicit physical headroom; release never refunds it.
    const config = configuration(); config.pool.outputBytes = 1_000_000; config.perRun.outputBytes = 200_000;
    await journal.admission({ kind: 'configure', configuration: config });
    const fresh = observation(at); fresh.capacity.outputBytes = 1_000_000;
    await journal.admission({ kind: 'observe', observation: fresh });
    await f.enqueue(journal, offer, at); reserved(await f.admit(journal, offer, at));
    const key = scope(offer); const draft = structuredClone(original.collected);
    const claim = await journal.admission({ kind: 'claimCreate', key, specDigest: draft.binding.specDigest });
    if (!('token' in claim)) throw new Error('Missing actual claim');
    const binding = { key, createToken: claim.token, specDigest: draft.binding.specDigest, runtimeId: `synthetic-delivery-${id}` };
    await journal.admission({ kind: 'bindRuntime', ...binding });
    const launch = { authority: 'supervisor' as const, ...binding, epoch: 0 as const, startToken: null,
      disposition: 'retired' as const, settledAt: at + 1, evidenceId: `synthetic-settlement-${id}` };
    await journal.admission({ kind: 'settleLaunch', settlement: launch });
    draft.binding = { ...draft.binding, ...key, generation: 1, intentDigest: offer.intentDigest,
      engine: offer.engine, installedIdentity: offer.installedIdentity };
    const { seal, ...body } = { ...draft.collection.value, ...key };
    const sealed = sealEngineResult(body, seal.sealedAt, hash); if (!sealed.ok) throw new Error('Synthetic result invalid');
    draft.collection.value = structuredClone(sealed.value);
    const event = { ...key, version: '1.0' as const, seq: 1, phase: 'seal' as const, kind: 'engine.result' as const,
      observedAt: '2026-01-01T00:00:00Z', payload: sealed.value };
    const raw = JSON.stringify(event) + '\n';
    const checkpoint = await journal.commitWrapperBatch({ key, expected: null, events: [event], next: {
      version: 1, dev: draft.collection.custody.root.device, ino: draft.checkpoint.ino, offset: Buffer.byteLength(raw), wrapperSeq: 1, prefixSha256: hash(raw) } });
    draft.checkpoint = checkpoint; draft.collection.custody.controlBytes = checkpoint.offset;
    draft.collection.verifiedBytes = draft.collection.custody.resultFileBytes + checkpoint.offset
      + draft.collection.value.artifacts.reduce((total, artifact) => total + artifact.bytes, 0);
    draft.collectionId = `10000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
    draft.release = { ...draft.release, ...binding, runtime: { ...draft.release.runtime, observedAt: at + 2 },
      collection: { ...draft.release.collection, observedAt: at + 4, evidenceId: draft.collectionId },
      launch: { epoch: 0, startToken: null, settlementId: launch.evidenceId } };
    const intent = captureCollectionIntent({ version: 1, collectionId: draft.collectionId, binding: draft.binding,
      root: draft.collection.custody.root, checkpoint, launch, runtime: draft.release.runtime, begunAt: at + 3 });
    await journal.beginOutputCollection(intent); const receipt = await journal.commitOutputSource(draft);
    if (release) await journal.releaseOutputSource(receipt);
    return { key, receipt };
  }
  function corruptCopy(path: string): DatabaseSync {
    const db = f.corruptCopy(path); db.prepare('ATTACH DATABASE ? AS closure_original').run(path);
    db.exec('CREATE TABLE output_delivery_closures AS SELECT * FROM closure_original.output_delivery_closures; DETACH DATABASE closure_original');
    return db;
  }
  return { ...f, ready, nativeReady, next, corruptCopy };
}
export function insertClosure(db: DatabaseSync, value: OutputDeliveryClosure, charge = Buffer.byteLength(json(value)) + 256): void {
  db.prepare('INSERT INTO output_delivery_closures(attempt_id,closure_json,charged_bytes) VALUES(?,?,?)')
    .run(value.receipt.key.attemptId, json(value), charge);
}
export function inspect(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return { rows: durableRows(db), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() }; } finally { db.close(); }
}
export const originalTables = tables;
