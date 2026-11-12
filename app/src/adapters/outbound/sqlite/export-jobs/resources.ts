import type {DatabaseSync} from 'node:sqlite';
import type {ExecutionResourceFact} from '../../../../ports/execution-resources.js';
import {StorageError} from '../protocol.js';
const columns="'standalone_export' AS purpose,queue_order,source_profile AS profile_alias,registry_digest,cpu_millis,memory_bytes,pids,timeout_ms,output_bytes,staging_bytes,maximum_build_bytes AS storage_bytes,mode";
function read(db:DatabaseSync,predicate:string,limit:number):ExecutionResourceFact[]{
 const rows=db.prepare(`SELECT ${columns} FROM export_jobs WHERE ${predicate} ORDER BY queue_order LIMIT ?`).all(limit+1);
 if(rows.length>limit)throw new StorageError('unavailable');
 return rows as unknown as ExecutionResourceFact[];
}
export function chargedExportResources(db:DatabaseSync):ExecutionResourceFact[]{return read(db,'execution_charged=1',64);}
export function pendingExportResources(db:DatabaseSync):ExecutionResourceFact[]{return read(db,"state='queued' AND cancellation_requested=0 AND possible_delivery=0",4096);}
