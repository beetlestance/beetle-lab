import { afterEach } from 'vitest';
import type { OutputAbsence } from '@beetle/contracts/output-source';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { initialize } from '../../../src/journal/schema.js';
import { Store } from '../../../src/journal/store.js';
import { admissionFixture, now, scope } from '../../admission/fixtures.js';

export const json = (input: unknown): string => encodeCanonicalJson(input, 2048);
export function insert(db: DatabaseSync, proof: OutputAbsence, verb = 'INSERT', charge = Buffer.byteLength(json(proof)) + 256): void {
  db.prepare(`${verb} INTO output_absence_closures(attempt_id,proof_json,charged_bytes) VALUES(?,?,?)`)
    .run(proof.attemptId, json(proof), charge);
}
export function absenceFixture() {
  const f = admissionFixture(); const databases = new Set<DatabaseSync>();
  afterEach(() => { for (const db of databases) db.close(); databases.clear(); });
  async function ready(fresh = false) {
    const path = f.path(); const journal = fresh ? await f.open(path) : await f.configured(path);
    const offer = fresh ? f.offer() : f.job(); const key = scope(offer);
    if (fresh) await journal.cancelOriginal({ offer, now });
    else { await f.enqueue(journal, offer); await f.admit(journal, offer); await journal.admission({ kind: 'abortUnstarted', key }); }
    const admission = (await journal.get(key)).admission;
    const proof = { version: 1, ...key, intentDigest: offer.intentDigest, journalAuthority: await journal.journalAuthority(),
      finalAgentSeq: fresh ? 0 : 1, admission, reason: fresh ? 'cancelled' : 'setup_failed' } as OutputAbsence;
    await f.close(journal); const db = initialize(path); databases.add(db); const store = new Store(db);
    return { db, store, path, offer, key, proof };
  }
  function closeNative(db: DatabaseSync): void { databases.delete(db); db.close(); }
  return { ...f, ready, closeNative };
}
