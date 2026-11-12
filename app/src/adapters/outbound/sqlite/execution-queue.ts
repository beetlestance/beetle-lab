import type {DatabaseSync} from 'node:sqlite';
import {StorageError} from './protocol.js';
/** One bounded installation queue; unknown originals retain their slots. */
export function checkExecutionQueue(db:DatabaseSync,limit:number):void {
 const rows=db.prepare(`SELECT id FROM runs INDEXED BY runs_pending WHERE state IN ('queued','dispatching','active','finalizing')
  UNION ALL SELECT id FROM export_jobs INDEXED BY exports_pending WHERE state IN ('queued','dispatching','generating','publishing','unknown') LIMIT ?`).all(limit);
 if(rows.length>=limit)throw new StorageError('queue_full');
}
