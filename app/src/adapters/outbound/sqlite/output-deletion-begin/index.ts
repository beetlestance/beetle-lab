import type { DatabaseSync } from 'node:sqlite';
import type { OutputDeletionCommand,OutputDeletionSummary } from '../../../../ports/output-deletion-metadata.js';
import { prepareOutputDeletion } from '../../../../application/output-deletion/index.js';
import type { OutputDeletions } from '../output-deletion/index.js';
import { captureDeletionReply } from '../output-deletion/index.js';
import { readMutationReceipt,writeMutationReceipt } from '../mutation-receipts.js';
import { sha256 } from '../input-values.js';
import { StorageError } from '../protocol.js';
/** Same fixed Begin executor for ordinary admission and retention batches. Caller owns transaction. */
export function beginOutputDeletionWithReceipt(db:DatabaseSync,deletions:OutputDeletions,input:OutputDeletionCommand):OutputDeletionSummary{
 const command=prepareOutputDeletion(input,sha256);const operation={kind:'beginOutputDeletion' as const,command};
 const receipt=readMutationReceipt(db,command,4096);
 if(receipt.kind==='stored'){
  try{return captureDeletionReply(operation,receipt.value) as OutputDeletionSummary;}catch{throw new StorageError('unavailable');}
 }
 const value=deletions.begin(command);return writeMutationReceipt(db,command,value,4096) as OutputDeletionSummary;
}
