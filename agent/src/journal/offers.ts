import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { offerInput } from './input.js';
import { columns, Failure, owner, snapshot } from './sql.js';
import type { Row } from './sql.js';

export function offerAtomic(db: DatabaseSync, input: { json: string; canonical: string }, quota: number): AttemptSnapshot {
  const offer = JSON.parse(input.json) as Offer;
  if (offerInput(offer).canonical !== input.canonical) throw new Failure('invalid_input');
  const existing = db.prepare(`SELECT ${columns},canonical_json FROM accepted_attempts WHERE attempt_id=?`)
    .get(offer.attemptId) as unknown as (Row & { canonical_json: string }) | undefined;
  if (existing) {
    if (existing.canonical_json !== input.canonical) throw new Failure('conflict');
    return snapshot(existing);
  }
  db.prepare(`INSERT INTO accepted_attempts
    (attempt_id,organization_id,workspace_id,intent_digest,generation,state,last_seq,offer_json,canonical_json,quota_bytes)
    VALUES (?,?,?,?,1,'offered',0,?,?,?)`).run(offer.attemptId, offer.organizationId,
    offer.workspaceId, offer.intentDigest, input.json, input.canonical, quota);
  return snapshot(owner(db, offer));
}
