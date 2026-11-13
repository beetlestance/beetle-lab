import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { Run,RetentionApplyReceipt } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { captureRetentionProgress } from '../../../../domain/retention/index.js';
import { prepareInitialDeletion } from '../output-deletion/index.js';
import { prepareOutputDeletion } from '../../../../application/output-deletion/index.js';
import { requireCleanupControl } from '../cleanup-control/index.js';
import { accounting,retentionBasis,requireFact } from '../retention-accounting/facts.js';
import { snapshotById } from '../retention-selection/rows.js';
import { cursorSnapshot } from '../retention-selection/values.js';
import { scopeKey,sha256 } from '../input-values.js';
import type { captureApplyCommand } from './values.js';
import { captureAppliedSnapshot } from './values.js';
import { expectedSequences,sequenceState } from './sequences.js';
type Command=ReturnType<typeof captureApplyCommand>;
function bindRequest(command:Command,snapshot:ReturnType<typeof snapshotById>['snapshot']):void{
 const request=command.request;requireFact(request.snapshotVersion===1&&request.settingsId===snapshot.settings.workspace.id);
 requireFact(request.expectedVersion===snapshot.settings.workspace.version&&request.page.limit===snapshot.candidates.length&&snapshot.candidates.length>0);
 if(request.page.cursor)requireFact(cursorSnapshot(request.page.cursor)===snapshot.id);
 const ids=new Set([snapshot.id,snapshot.requestId]);for(const child of snapshot.candidates)for(const id of [child.id,child.deletionId,child.requestId])ids.add(id);
 requireFact(!ids.has(command.id)&&!ids.has(request.requestId)&&command.id!==request.requestId);
}
function child(db:DatabaseSync,runs:{get(key:RunKey):Run},snapshot:ReturnType<typeof snapshotById>['snapshot'],member:typeof snapshot.candidates[number],appliedAt:string){
 const request={scope:snapshot.scope,runId:member.id,requestId:member.requestId,expectedRunVersion:member.version};
 const command=prepareOutputDeletion({kind:'beginOutputDeletion',id:member.deletionId,requestedAt:appliedAt,request},sha256);
 const prepared=prepareInitialDeletion(db,runs,command);requireCleanupControl(db,prepared.original);
 requireFact(prepared.summary.retainedPayloadBytes+prepared.summary.metadataBytes+65536===member.estimatedBytes);
 const scope=scopeKey(snapshot.scope);requireFact(!db.prepare('SELECT 1 FROM receipts WHERE scope_key=? AND request_id=?').get(scope,member.requestId));
 return{...prepared,receiptBinding:JSON.stringify([scope,member.requestId,command.intentDigest]),receiptCanonical:encodeCanonicalJson(prepared.summary,4096),fileBindings:new Set(prepared.files.map(file=>file.binding)),
  progress:encodeCanonicalJson(captureRetentionProgress({phase:'admitted',preparedCount:0,absentCount:0,fileCount:prepared.summary.fileCount,error:null}),256)};
}
function freshBasis(db:DatabaseSync,command:Command,snapshot:ReturnType<typeof snapshotById>['snapshot']){
 const stats=accounting(db);const now=Date.parse(command.appliedAt);requireFact(now>=stats.clock_ms&&now>=Date.parse(snapshot.capturedAt)&&now<Date.parse(snapshot.expiresAt));
 const basis=retentionBasis(db,snapshot.scope);requireFact(snapshot.epoch===basis.epoch);
 requireFact(encodeCanonicalJson([snapshot.settings,snapshot.policy,snapshot.policySource],4096)===encodeCanonicalJson([basis.settings,basis.policy,basis.policySource],4096));
 requireFact(db.prepare('SELECT epoch FROM retention_workspace_epochs WHERE workspace_id=? AND organization_id=?').get(snapshot.scope.workspaceId,snapshot.scope.organizationId)?.epoch===snapshot.epoch);
 requireFact(snapshot.epoch<=Number.MAX_SAFE_INTEGER-snapshot.candidates.length);return stats;
}
/** Prepare every original before any permission frame or Begin. No SQL/native mutations. */
export function prepareRetentionApply(db:DatabaseSync,runs:{get(key:RunKey):Run},command:Command){
 requireFact(db.isTransaction);const stored=snapshotById(db,command.request.scope,command.request.snapshotId);requireFact(stored.state==='preview');const snapshot=stored.snapshot;bindRequest(command,snapshot);
 const stats=freshBasis(db,command,snapshot);const scope=scopeKey(snapshot.scope);
 requireFact(!db.prepare('SELECT 1 FROM receipts WHERE scope_key=? AND request_id=?').get(scope,command.request.requestId));
 requireFact(!db.prepare("SELECT 1 FROM retention_snapshots WHERE workspace_id=? AND (request_id=? OR json_extract(apply_json,'$.requestId')=?) LIMIT 1").get(snapshot.scope.workspaceId,command.request.requestId,command.request.requestId));
 const children=snapshot.candidates.map(member=>child(db,runs,snapshot,member,command.appliedAt));const beforeSequences=sequenceState(db);
 const receipt:RetentionApplyReceipt={id:command.id,version:1,scope:snapshot.scope,requestId:command.request.requestId,settingsId:snapshot.settings.workspace.id,settingsVersion:snapshot.settings.workspace.version,
  snapshotId:snapshot.id,snapshotVersion:1,state:'admitted',maximumCandidates:children.length};
 const applied=captureAppliedSnapshot({version:1,requestId:command.request.requestId,intentDigest:command.intentDigest,appliedAt:command.appliedAt,receipt},snapshot);
 const usage=db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes;requireFact(typeof usage==='number'&&Number.isSafeInteger(usage)&&usage>=stats.charged_bytes,'unavailable');
 return{snapshot,children,stats,usage,snapshotBody:encodeCanonicalJson(snapshot,32768),applied,applyBody:encodeCanonicalJson(applied,2048),
  expectedEpoch:snapshot.epoch+children.length,firstSequence:(beforeSequences.get('output_deletion_intents')??0)+1,sequences:expectedSequences(beforeSequences,children.length)};
}
