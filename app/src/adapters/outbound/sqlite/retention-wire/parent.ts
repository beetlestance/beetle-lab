import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { sameScope,immutableSnapshot } from '../../../../domain/namespaces/index.js';
import { captureRetentionSnapshot } from '../../../../domain/retention/index.js';
import { timestamp } from '../../../../domain/retention/snapshot-fields.js';
import type { ParentRetentionPage,ParentRetentionPreviewCommand } from '../../../../ports/retention.js';
import { closed } from '../output-deletion/values.js';
import { requireFact } from '../retention-accounting/facts.js';
import { captureParentCommand } from '../retention-parent/values.js';
import { cursorSnapshot,previewCursor } from '../retention-selection/values.js';
type Command=ReturnType<typeof captureParentCommand>;
function header(input:unknown,command:Command){
 const request=command.request;const value:unknown=JSON.parse(encodeJson(input,40960));closed(value,['scope','requestId','settingsId','settingsVersion','capturedAt','coverage','durable','workspace','nextCursor']);
 requireFact(encodeCanonicalJson(value.scope,256)===encodeCanonicalJson(request.scope,256)&&value.requestId===request.requestId&&value.settingsId===request.settingsId&&value.settingsVersion===request.expectedVersion);
 requireFact(value.coverage==='live_partial');return value;
}
function bindWorkspace(workspace:ReturnType<typeof captureRetentionSnapshot>,command:Command){
 const request=command.request;const context=workspace.traversal;requireFact(context&&workspace.kind==='retention'&&sameScope(context.scope,request.scope));
 const pin=request.scope.kind==='installation'?workspace.settings.installation:workspace.settings.organization;
 requireFact(pin.id===request.settingsId&&pin.version===request.expectedVersion&&workspace.requestId===request.requestId&&workspace.intentDigest===command.intentDigest);
 const previous=request.page.cursor?cursorSnapshot(request.page.cursor):null;requireFact(context.previousSnapshotId===previous);requireFact(workspace.scanned<=request.page.limit);return context;
}
/** Closed parent envelope; all durable authority stays in the captured child snapshot. */
export function captureParentReply(input:unknown,original:ParentRetentionPreviewCommand):ParentRetentionPage{
 const command=captureParentCommand(original);const request=command.request;const value=header(input,command);const capturedAt=timestamp(value.capturedAt);
 const workspace=value.workspace===null?null:captureRetentionSnapshot(value.workspace);
 if(workspace){
  const context=bindWorkspace(workspace,command);requireFact(capturedAt===workspace.capturedAt);
  requireFact(value.durable===true&&value.nextCursor===(workspace.hasMore||context.nextWorkspace!==null?previewCursor(workspace.id):null));
 }else requireFact(value.durable===false&&value.nextCursor===null&&capturedAt===command.capturedAt);
 return immutableSnapshot({scope:request.scope,requestId:request.requestId,settingsId:request.settingsId,settingsVersion:request.expectedVersion,capturedAt,coverage:'live_partial',durable:workspace!==null,workspace,nextCursor:value.nextCursor as string|null});
}
