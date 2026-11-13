import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureRetentionSnapshot,RETENTION_SNAPSHOT_BODY_BYTES } from '../../../../domain/retention/index.js';
import { commitRetentionClock,commitRetentionExpiry,commitRetentionReservation } from '../retention-accounting-guard/index.js';
import { accounting,requireFact } from './facts.js';
/** Internal transaction participant; no selection, deletion or refund authority. */
export function reserveRetentionSnapshot(db:DatabaseSync,input:unknown,now:number){
 requireFact(db.isTransaction);const proposal=captureRetentionSnapshot(input);
 requireFact(Number.isSafeInteger(now)&&now>=0&&now<=8640000000000000);
 const row=db.prepare(`SELECT id,intent_digest,CASE WHEN length(CAST(body_json AS BLOB))<=32768 THEN body_json END body
  FROM retention_snapshots WHERE workspace_id=? AND organization_id=? AND request_id=?`).get(proposal.scope.workspaceId,proposal.scope.organizationId,proposal.requestId);
 if(!row)return commitRetentionReservation(db,proposal,now);
 requireFact(row.intent_digest===proposal.intentDigest);requireFact(typeof row.body==='string','unavailable');
 const stored=captureRetentionSnapshot(JSON.parse(row.body));
 requireFact(stored.id===row.id&&stored.intentDigest===row.intent_digest&&encodeCanonicalJson(stored,RETENTION_SNAPSHOT_BODY_BYTES)===row.body,'unavailable');
 requireFact(Date.parse(stored.expiresAt)>Math.max(now,accounting(db).clock_ms));return stored;
}

/** Standalone maintenance transaction participant. All applied work stays charged/protected. */
export function pruneRetentionSnapshots(db:DatabaseSync,now:number){
 const clock=commitRetentionClock(db,now);const rows=db.prepare("SELECT id FROM retention_snapshots WHERE state='preview' AND expires_at<=? ORDER BY expires_at,id LIMIT 8")
  .all(new Date(clock).toISOString());let removed=0;
 for(const row of rows){requireFact(typeof row.id==='string','unavailable');if(commitRetentionExpiry(db,row.id,clock))removed++;}
 return Object.freeze({removed,refundedBytes:removed*131072,observedAtMs:clock});
}

export { retentionBasis } from './facts.js';
