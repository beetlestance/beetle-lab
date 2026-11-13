import type { DatabaseSync } from 'node:sqlite';
import type { OutputDeletionPage,OutputDeletionScan } from '../../../../ports/output-deletion-metadata.js';
import { StorageError } from '../protocol.js';
import { summary } from './rows.js';
import {natural} from './values.js';
import type {RetirementPosition} from './retirement-cursor.js';
import { retirementCursor,retirementPosition } from './retirement-cursor.js';
const eligible="pending_files=0 AND kind IN ('source','absence')";
/** Capture physical candidates before ACK filtering: no unbounded anti-join walk. */
export function scanRetirements(db:DatabaseSync,query:OutputDeletionScan):OutputDeletionPage{
 natural(query.limit,32,1);const position=window(db,query);
 const rows=db.prepare(`SELECT d.id,d.run_id,d.organization_id,d.workspace_id,d.sequence,
  EXISTS(SELECT 1 FROM backend_output_cleanup_acks a WHERE a.deletion_id=d.id) acked
  FROM output_deletion_intents d INDEXED BY output_deletion_retirable WHERE ${eligible} AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`)
  .all(position.after,position.upper,query.limit+1);
 const selected=rows.slice(0,query.limit);const last=selected.at(-1);
 return {items:selected.filter(item=>item.acked===0).map(item=>summary(db,{id:item.id as string,runId:item.run_id as string,
  scope:{kind:'workspace',organizationId:item.organization_id as string,workspaceId:item.workspace_id as string}})),
  nextCursor:rows.length>query.limit&&last?retirementCursor({installationId:position.installationId,upper:position.upper,after:last.sequence as number},query.limit):null};
}

function window(db:DatabaseSync,query:OutputDeletionScan):RetirementPosition{
 const row=db.prepare("SELECT id FROM settings WHERE scope_key='installation'").get();if(typeof row?.id!=='string')throw new StorageError('unavailable');
 const previous=retirementPosition(query);if(previous&&previous.installationId!==row.id)throw new StorageError('invalid_input');
 if(previous)return previous;
 const upper=Number(db.prepare(`SELECT coalesce(max(sequence),0) upper FROM output_deletion_intents INDEXED BY output_deletion_retirable WHERE ${eligible}`).get()?.upper);
 if(!Number.isSafeInteger(upper)||upper<0)throw new StorageError('unavailable');
 return {installationId:row.id,upper,after:0};
}
