import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { RetentionPreview,RetentionBatchStatus,RetentionApplyReceipt } from '@beetle/contracts/api';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { json,testClient,ids } from '../../app/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { settings,workspaceScope as scope } from '../settings/test-fixtures.js';
import { RetentionControls } from './index.js';
export { scope,ids,json };
export const id='11111111-1111-4111-8111-111111111111';
export const runId='22222222-2222-4222-8222-222222222222';
export function preview(body:Record<string,unknown>,manual=false):RetentionPreview{
 const capturedAt=new Date(Date.now()-1000).toISOString();return{snapshotId:(body.page as {cursor?:string}|undefined)?.cursor?'44444444-4444-4444-8444-444444444444':id,version:1,scope,requestId:body.requestId as string,settingsId:body.settingsId as string,settingsVersion:body.expectedVersion as number,
  policy:{mode:'enabled',ageDays:1},kind:manual?'manual':'retention',capturedAt,expiresAt:new Date(Date.parse(capturedAt)+900000).toISOString(),scanned:1,
  candidates:[{id:runId,version:manual?body.expectedRunVersion as number:2,scope,reason:manual?'manual':'age',estimatedBytes:65536}],estimatedBytes:65536,protectedExclusions:[],nextCursor:null};
}
interface Stored {snapshot:RetentionPreview|null;state:RetentionBatchStatus['state'];receipt:RetentionApplyReceipt|null}
function mutation(request:RequestRecord,model:Stored):Response|undefined{
 const path=request.path;const body=request.body!;
 if(path.endsWith('/retention-preview')||path.endsWith('/deletion-preview')){model.snapshot=preview(body,path.endsWith('/deletion-preview'));return json(model.snapshot);}
 if(path.endsWith('/retention-apply')){model.state='applied';model.receipt??={id:ids.request,version:1,scope,requestId:body.requestId as string,settingsId:body.settingsId as string,settingsVersion:body.expectedVersion as number,snapshotId:body.snapshotId as string,snapshotVersion:1,state:'admitted',maximumCandidates:1};return json(model.receipt,202);}
 if(path.endsWith('/discard')){const removed=model.snapshot?.snapshotId??id;model.snapshot=null;return json({id:removed,scope,refundedLogicalBytes:131072});}
 return undefined;
}
function inventory(model:Stored){
 const stored=model.snapshot;return{scope,items:stored?[{id:stored.snapshotId,scope,kind:stored.kind,state:model.state,capturedAt:stored.capturedAt,expiresAt:stored.expiresAt,completedAt:model.state==='completed'?new Date().toISOString():null,candidateCount:stored.candidates.length}]:[]};
}
export function fixture(intercept?:(request:RequestRecord)=>Response|Promise<Response>|undefined){
 const model:Stored={snapshot:null,state:'preview',receipt:null};
 const f=testClient(request=>{
  const intercepted=intercept?.(request);if(intercepted)return intercepted;
  const changed=mutation(request,model);if(changed)return changed;
  const path=request.path;if(path.endsWith('/settings'))return json(settings(scope));
  if(path.endsWith('/retention-batches'))return json(inventory(model));
  if(path.endsWith('/preview'))return json(model.snapshot);
  if(model.snapshot&&path.endsWith('/'+model.snapshot.snapshotId))return json(status(model.snapshot,model.state));
  throw Error('Unexpected synthetic retention route');
 });
 return{...f,storePreview:(value:RetentionPreview)=>{model.snapshot=value;},complete:()=>{model.state='completed';},mount:(run?:{id:string;version:number})=>{
  const client=createQueryClient();const view=render(<ApiContext.Provider value={f.client}><QueryClientProvider client={client}><RetentionControls scope={scope} {...(run?{run}:{})}/></QueryClientProvider></ApiContext.Provider>);return{...view,client};
 }};
}
export function status(value:RetentionPreview,state:RetentionBatchStatus['state']):RetentionBatchStatus{
 const complete=state==='completed';return{id:value.snapshotId,scope,kind:value.kind,state,capturedAt:value.capturedAt,expiresAt:value.expiresAt,completedAt:complete?new Date().toISOString():null,estimatedLogicalBytes:value.estimatedBytes,
  completedCount:complete?1:0,refundedLogicalBytes:complete?62976:0,items:statusItems(value,state)};
}

function statusItems(value:RetentionPreview,state:RetentionBatchStatus['state']):RetentionBatchStatus['items']{
 const complete=state==='completed';return value.candidates.length===0?[]:[{runId,runVersion:value.candidates[0]!.version,deletionId:'33333333-3333-4333-8333-333333333333',phase:complete?'settled':state==='preview'?'preview':'settling',fileCount:state==='preview'?null:0,preparedCount:state==='preview'?null:0,absentCount:state==='preview'?null:0,error:null,refundedLogicalBytes:complete?62976:0}];
}
