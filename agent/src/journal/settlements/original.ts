import type { DatabaseSync } from 'node:sqlite';
import { RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { Scope } from '../../admission/index.js';
import { retirementDigest } from '../../retirement-values/index.js';
import { owner,quotaUsed,Failure } from '../sql.js';
/** Bounded original hash and exact persisted charge components; no refund authority. */
export function settlementOriginal(db:DatabaseSync,key:Scope){
 const row=owner(db,key);if(row.execution_purpose!=='performance'||quotaUsed(row)>row.quota_bytes
  ||db.prepare('SELECT 1 FROM export_assignments WHERE attempt_id=?').get(key.attemptId))throw new Failure('conflict');
 const text=db.prepare(`SELECT CASE WHEN length(CAST(canonical_json AS BLOB))<=? THEN canonical_json END json
  FROM accepted_attempts WHERE attempt_id=?`).get(RUNNER_MAXIMUM_OFFER_BYTES,key.attemptId)?.json;
 if(typeof text!=='string')throw new Failure('conflict');
 return{row,offerDigest:retirementDigest(text),charges:{spoolBytes:row.spool_bytes,snapshotBytes:row.snapshot_bytes,checkpointBytes:row.checkpoint_bytes,
  holdBytes:row.hold_bytes,collectionBytes:row.collection_bytes,sourceBytes:row.source_bytes,deliveryBytes:row.delivery_bytes,
  absenceBytes:row.absence_bytes,cleanupControlBytes:row.cleanup_control_bytes}};
}
