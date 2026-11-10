import type { DatabaseSync } from 'node:sqlite';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { offerAtomic } from './offers.js';
import { snapshot } from './snapshot.js';
import { checkedSupervision, superviseAtomic } from './supervision.js';
import { owner, transaction } from './sql.js';

/** Receipt absence and refusal authority are decided only under the same write lock. */
export function cancelOriginal(db: DatabaseSync,
  input: { json: string; canonical: string; now: number }, quota: number): AttemptSnapshot {
  const offer = JSON.parse(input.json) as Offer;
  const key = { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId, generation: 1 };
  const supervision = { key, now: input.now, cancel: true as const };
  checkedSupervision(supervision);
  return transaction(db, () => {
    const fresh = !db.prepare('SELECT 1 FROM accepted_attempts WHERE attempt_id=?').get(offer.attemptId);
    offerAtomic(db, input, quota);
    superviseAtomic(db, supervision);
    if (fresh) db.prepare('INSERT INTO cancelled_originals(attempt_id,generation) VALUES (?,1)').run(offer.attemptId);
    return snapshot(db, owner(db, supervision.key));
  });
}
