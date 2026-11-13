import {agentRetirementReady} from './readiness.js';
import type { DatabaseSync } from 'node:sqlite';
import type { OutputDeletionPage,OutputDeletionScan } from '../../../../ports/output-deletion-metadata.js';
import { StorageError } from '../protocol.js';
import { summary } from './rows.js';
import { natural } from './values.js';
import { settlementCursor,settlementPosition } from './settlement-cursor.js';
/** Primary sequence horizon bounds physical work before readiness/ACK filtering. */
export function scanSettlements(db:DatabaseSync,query:OutputDeletionScan):OutputDeletionPage{
 natural(query.limit,32,1);const position=window(db,query);
 const rows=db.prepare(`SELECT d.id,d.run_id,d.organization_id,d.workspace_id,d.sequence,
  d.pending_files=0 AND (d.kind='unsent' OR (EXISTS(SELECT 1 FROM backend_output_cleanup_acks a WHERE a.deletion_id=d.id)
   AND ${agentRetirementReady})) ready
  FROM output_deletion_intents d WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`).all(position.after,position.upper,query.limit+1);
 const selected=rows.slice(0,query.limit);const last=selected.at(-1);
 return{items:selected.filter(row=>row.ready===1).map(row=>summary(db,{id:row.id as string,runId:row.run_id as string,
  scope:{kind:'workspace',organizationId:row.organization_id as string,workspaceId:row.workspace_id as string}})),
  nextCursor:rows.length>query.limit&&last?settlementCursor({...position,after:last.sequence as number},query.limit):null};
}

function window(db:DatabaseSync,query:OutputDeletionScan){
 const installationId=db.prepare("SELECT id FROM settings WHERE scope_key='installation'").get()?.id;
 if(typeof installationId!=='string')throw new StorageError('unavailable');
 const previous=settlementPosition(query);if(previous&&previous.installationId!==installationId)throw new StorageError('invalid_input');
 const upper=previous?previous.upper:Number(db.prepare('SELECT coalesce(max(sequence),0) upper FROM output_deletion_intents').get()?.upper);
 if(!Number.isSafeInteger(upper)||upper<0)throw new StorageError('unavailable');
 return previous??{installationId,upper,after:0};
}
