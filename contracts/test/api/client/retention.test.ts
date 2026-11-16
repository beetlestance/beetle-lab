import type { RetentionTraversalPage } from '../../../src/api/index.js';
import { it,expect,vi } from 'vitest';
import { createApiClient } from '../../../src/api/index.js';
import { fixture } from '../fixtures.js';
import { baseUrl,params,reply } from './helpers.js';
const other='00000000-0000-4000-8000-000000000099';
it('binds batch status to route scope/ID and refuses duplicate or fabricated completion/refund',async()=>{
 const value=await fixture('valid/retention-batch-status.json') as Record<string,unknown>;const items=value.items as Record<string,unknown>[];
 const key={...params,snapshotId:value.id as string};
 for(const forged of [{...value,id:other},{...value,items:[items[0],items[0]]},{...value,completedCount:1},{...value,refundedLogicalBytes:1},{...value,state:'completed',completedAt:value.capturedAt}]){
  const client=createApiClient({baseUrl,fetch:reply(forged)});expect(await client.getWorkspaceRetentionStatus({params:key})).toEqual({ok:false,error:{kind:'response'}});
 }
});
it('refuses duplicate/cross-workspace inventory and wrong acknowledgement identity',async()=>{
 const value=await fixture('valid/retention-batch-list.json') as {scope:Record<string,unknown>;items:Record<string,unknown>[]};
 for(const forged of [{...value,items:[value.items[0],value.items[0]]},{...value,items:[{...value.items[0],scope:{...value.scope,workspaceId:other}}]}]){
  expect(await createApiClient({baseUrl,fetch:reply(forged)}).listWorkspaceRetention({params})).toEqual({ok:false,error:{kind:'response'}});
 }
 const discarded=await fixture('valid/retention-discard-receipt.json') as Record<string,unknown>;
 expect(await createApiClient({baseUrl,fetch:reply({...discarded,id:other})}).discardWorkspaceRetention({params:{...params,snapshotId:discarded.id as string}})).toEqual({ok:false,error:{kind:'response'}});
});
it('binds manual preview requests and replies to the exact Run and version before accepting a preview',async()=>{
 const body=await fixture('valid/manual-run-deletion-request.json') as {scope:typeof params&{kind:'workspace'};runId:string;expectedRunVersion:number;requestId:string;settingsId:string;expectedVersion:number};
 const fetcher=vi.fn<typeof fetch>();const client=createApiClient({baseUrl,fetch:fetcher});expect(await client.previewRunDeletion({params:{...params,runId:other},body})).toEqual({ok:false,error:{kind:'request'}});expect(fetcher).not.toHaveBeenCalled();
 const original=await fixture('valid/retention-preview.json') as Record<string,unknown>;
 const candidate={id:body.runId,scope:body.scope,version:body.expectedRunVersion,estimatedBytes:1024,reason:'manual'};
 const value={...original,scope:body.scope,kind:'manual',scanned:1,candidates:[candidate],protectedExclusions:[]};
 expect((await createApiClient({baseUrl,fetch:reply(value)}).previewRunDeletion({params:{...params,runId:body.runId},body})).ok).toBe(true);
 for(const forged of [{...value,candidates:[{...candidate,version:99}]},{...value,candidates:[{...candidate,id:other}]}])expect(await createApiClient({baseUrl,fetch:reply(forged)}).previewRunDeletion({params:{...params,runId:body.runId},body})).toEqual({ok:false,error:{kind:'response'}});
});
it('binds recovered preview and Apply receipt to snapshot identity and exact candidate count',async()=>{
 const original=await fixture('valid/retention-preview.json') as Record<string,unknown>;const body=await fixture('valid/retention-apply-request.json') as Record<string,unknown>;const receipt=await fixture('valid/retention-apply-receipt.json') as Record<string,unknown>;
 expect(await createApiClient({baseUrl,fetch:reply({...original,scope:{kind:'workspace',...params},snapshotId:other})}).getWorkspaceRetentionPreview({params:{...params,snapshotId:original.snapshotId as string}})).toEqual({ok:false,error:{kind:'response'}});
 const fetcher=reply({...receipt,scope:{kind:'workspace',...params},maximumCandidates:1},202);const client=createApiClient({baseUrl,fetch:fetcher});
 const request={...body,scope:{kind:'workspace',...params}} as Parameters<typeof client.applyWorkspaceRetention>[0]['body'];
 expect(await client.applyWorkspaceRetention({params,body:request})).toEqual({ok:false,error:{kind:'response'}});
});

it('binds parent traversal scope/intent and its workspace without granting global coverage or application',async()=>{
 const body=await fixture('valid/retention-preview-request.json') as Parameters<ReturnType<typeof createApiClient>['previewOrganizationRetention']>[0]['body'];
 const original=await fixture('valid/retention-traversal-page.json') as RetentionTraversalPage;const input={params:{organizationId:params.organizationId},body};
 for(const forged of [{...original,durable:false},{...original,requestId:other},{...original,nextCursor:btoa(other)},
  {...original,workspace:{...original.workspace!,scope:{kind:'workspace',organizationId:other,workspaceId:params.workspaceId}}},
  {...original,workspace:{...original.workspace!,requestId:other}},{...original,coverage:'complete'}]){
  expect(await createApiClient({baseUrl,fetch:reply(forged)}).previewOrganizationRetention(input)).toMatchObject({ok:false,error:{kind:'response'}});
 }
 const empty={...original,durable:false,workspace:null,nextCursor:null};expect((await createApiClient({baseUrl,fetch:reply(empty)}).previewOrganizationRetention(input)).ok).toBe(true);
 expect(await createApiClient({baseUrl,fetch:reply({...empty,durable:true})}).previewOrganizationRetention(input)).toEqual({ok:false,error:{kind:'response'}});
});
