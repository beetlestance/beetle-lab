import { assertOfferNotRetired } from './settlements/rows.js';
import { insertExport, requirePurpose } from './export-assignment.js';
import { snapshot } from './snapshot.js';
import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot, Offer, StandaloneExportAssignment } from '@beetle/contracts';
import { offerInput } from './input.js';
import { columns, Failure, owner } from './sql.js';
import type { Row } from './sql.js';

export function offerAtomic(db: DatabaseSync, input: { json: string; canonical: string }, quota: number, assignment?: StandaloneExportAssignment): AttemptSnapshot {
  const offer = JSON.parse(input.json) as Offer;
  if (offerInput(offer).canonical !== input.canonical) throw new Failure('invalid_input');
  assertOfferNotRetired(db,offer.attemptId);
  const existing = db.prepare(`SELECT ${columns},canonical_json FROM accepted_attempts WHERE attempt_id=?`)
    .get(offer.attemptId) as unknown as (Row & { canonical_json: string }) | undefined;
  if (existing) {
    owner(db, offer); requirePurpose(db,offer,assignment);
    if (existing.canonical_json !== input.canonical) throw new Failure('conflict');
    return snapshot(db, existing);
  }
  db.prepare(`INSERT INTO accepted_attempts
    (attempt_id,organization_id,workspace_id,intent_digest,generation,state,last_seq,offer_json,canonical_json,quota_bytes,execution_purpose)
    VALUES (?,?,?,?,1,'offered',0,?,?,?,?)`).run(offer.attemptId, offer.organizationId,
    offer.workspaceId, offer.intentDigest, input.json, input.canonical, quota,assignment ? 'standalone_export' : 'performance');
  insertExport(db,assignment);
  return snapshot(db, owner(db, offer));
}
