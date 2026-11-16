import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureDeletionReply } from '../output-deletion/index.js';
import { readMutationReceipt } from '../mutation-receipts.js';
import { accounting,requireFact } from '../retention-accounting/facts.js';
import { verifySequences } from './sequences.js';
import type { prepareRetentionApply } from './facts.js';
type Prepared=ReturnType<typeof prepareRetentionApply>;
export function verifyAppliedChild(db:DatabaseSync,p:Prepared,index:number):void{
 const child=p.children[index];requireFact(child);
 const row=db.prepare(`SELECT sequence,json_array(id,run_id,attempt_id,organization_id,workspace_id,request_id,run_version,deletion_version,version,kind,
  requested_at,closure_digest,retained_payload_bytes,metadata_bytes,file_count,pending_files,namespace_identity) binding FROM output_deletion_intents WHERE id=?`).get(child.command.id);
 requireFact(row?.sequence===p.firstSequence+index&&row.binding===child.intentBinding);
 const files=db.prepare('SELECT json_array(deletion_id,attempt_id,ordinal,original_version,version,namespace_identity,preparation_identity,absent) binding FROM output_deletion_files WHERE deletion_id=? ORDER BY ordinal LIMIT 129').all(child.command.id);
 requireFact(files.length===child.files.length);files.forEach((file,ordinal)=>requireFact(file.binding===child.files[ordinal]?.binding));
 const receipt=readMutationReceipt(db,child.command,4096);requireFact(receipt.kind==='stored');
 const summary=captureDeletionReply({kind:'beginOutputDeletion',command:child.command},receipt.value);
 requireFact(encodeCanonicalJson(summary,4096)===child.receiptCanonical);
}
export function verifyApplyTotals(db:DatabaseSync,p:Prepared):void{
 requireFact(db.prepare('SELECT epoch FROM retention_workspace_epochs WHERE organization_id=? AND workspace_id=?').get(p.snapshot.scope.organizationId,p.snapshot.scope.workspaceId)?.epoch===p.expectedEpoch);
 requireFact(db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes===p.usage);
 requireFact(encodeCanonicalJson(accounting(db),1024)===encodeCanonicalJson(p.stats,1024));verifySequences(db,p.sequences);
}
