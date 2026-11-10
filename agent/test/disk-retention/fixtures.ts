import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach } from 'vitest';
import type { Offer } from '@beetle/contracts';
import type { Candidate, Reservation } from '../../src/admission/index.js';
import { initialize, migration002 } from '../../src/journal/schema.js';
import { migration003 } from '../../src/journal/migration003.js';
import { migration004 } from '../../src/journal/supervision.js';
import { migration005 } from '../../src/journal/migration005.js';
import { migration006 } from '../../src/journal/migration006.js';
import { migration007 } from '../../src/journal/migration007.js';
import { migration008 } from '../../src/journal/migration008.js';
import { migration009 } from '../../src/journal/migration009.js';
import { migration010 } from '../../src/journal/migration010.js';
import { AdmissionStore } from '../../src/journal/admission-store.js';
import { projectCandidate } from '../../src/journal/admission-candidate.js';
import { configuration, now, observation, reserved, scope, validation } from '../admission/fixtures.js';

export { configuration, now, observation, reserved, scope, validation };
const original = JSON.parse(readFileSync('contracts/fixtures/valid/offer.json', 'utf8')) as Offer;
const handles = new Set<DatabaseSync>();
afterEach(() => { for (const db of handles) db.close(); handles.clear(); });
export function job(id = 1): Offer {
  const value = structuredClone(original);
  value.attemptId = `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`;
  value.organizationId = `00000000-0000-4000-8001-${id.toString().padStart(12, '0')}`;
  value.budget = { cpuMillis: 1000, memoryBytes: 1000, pids: 10, outputBytes: 100, timeoutMs: 1000 };
  value.executionPolicy.preferIdle = false;
  return value;
}
export function candidate(offer = job()): Candidate {
  const item = projectCandidate({ kind: 'offer', offer, validation: validation(offer), now }, false, 0);
  if (!item) throw new Error('candidate fixture');
  return { ...item, order: 1 };
}
export function reservation(item: Candidate, charged = true): Reservation {
  return { ...item, status: charged ? 'charged' : 'released', admittedAt: now, createToken: null, specDigest: null,
    runtimeId: null, startToken: null, launchEpoch: 0, startClaimedAt: null, launchClosed: !charged,
    launchSettlement: null, aborted: !charged, releaseEvidence: null };
}
export function native(quota = 67_108_864) {
  const db = initialize(':memory:'); handles.add(db);
  const store = new AdmissionStore(db, quota);
  store.execute({ kind: 'configure', configuration: configuration() });
  store.execute({ kind: 'observe', observation: observation() });
  return { db, store,
    enqueue(offer: Offer) { return store.execute({ kind: 'offer', offer, validation: validation(offer), now }); },
    admit(offer: Offer, sourceOrdinal = 1) { return store.execute({ kind: 'admit', key: scope(offer), sourceOrdinal, now }); },
    abort(offer: Offer) { return store.execute({ kind: 'abortUnstarted', key: scope(offer) }); } };
}
/** Apply the historical migrations with FK enforcement enabled; no synthetic downgrade. */
export function legacy(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true }); handles.add(db);
  db.exec(`CREATE TABLE accepted_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT,attempt_id TEXT,
    organization_id TEXT,workspace_id TEXT,intent_digest TEXT,generation INTEGER,state TEXT,last_seq INTEGER,
    cancel_requested INTEGER,offer_json TEXT,canonical_json TEXT);`);
  for (const sql of [migration002, migration003, migration004, migration005, migration006,
    migration007, migration008, migration009, migration010]) db.exec(sql);
  return db;
}
export function legacyRow(db: DatabaseSync, id = 1, charged = true): Reservation {
  const offer = job(id); const item = { ...candidate(offer), order: id };
  const value = reservation(item, charged);
  db.prepare(`INSERT INTO accepted_attempts(attempt_id,organization_id,workspace_id,intent_digest,
    generation,state,last_seq,offer_json,canonical_json) VALUES(?,?,?,?,1,'admitted',0,?,?)`)
    .run(offer.attemptId, offer.organizationId, offer.workspaceId, offer.intentDigest, JSON.stringify(offer), JSON.stringify(offer));
  db.prepare('INSERT INTO admission_queue(id,attempt_id,candidate_json,pending) VALUES(?,?,?,0)')
    .run(id, offer.attemptId, JSON.stringify({ ...item, order: 0 }));
  db.prepare('INSERT INTO reservations(attempt_id,reservation_json,charged) VALUES(?,?,?)')
    .run(offer.attemptId, JSON.stringify(value), charged ? 1 : 0);
  return value;
}
export function stats(db: DatabaseSync) { return { ...db.prepare('SELECT * FROM disk_retention_stats').get() }; }
export function close(db: DatabaseSync): void { db.close(); handles.delete(db); }
