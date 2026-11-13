import { it,expect } from 'vitest';
import { selected } from './apply-fixture.js';
import { command } from './selection-fixture.js';
import { scope,uuid } from './fixture.js';
import { RetentionProgress } from '../../src/adapters/outbound/sqlite/retention-progress/index.js';
import { captureRetentionOperation,captureRetentionReply } from '../../src/adapters/outbound/sqlite/retention-wire/index.js';
import type { RetentionOperation } from '../../src/ports/retention.js';
it('captures the closed request on both boundaries and rejects extra/cursor/unsafe time fields',()=>{
 const f=selected();try{
  const request={key:{scope,id:f.page.id},now:Date.parse(f.input.appliedAt)};const op={kind:'getWorkspaceRetentionStatus' as const,request};
  expect(captureRetentionOperation({...op,messageId:1})).toEqual(op);
  for(const value of [{...op,extra:true},{...op,messageId:0},{...op,request:{...request,now:-1}},{...op,request:{...request,key:{...request.key,extra:true}}}])expect(()=>captureRetentionOperation(value)).toThrow();
 }finally{f.db.close();}
});
it('binds preview request/scope/settings and predecessor independently of caller allocation ID',()=>{
 const f=selected();try{
  const op:RetentionOperation={kind:'previewWorkspaceRetention',command:command(f)};expect(captureRetentionReply(op,f.page)).toEqual(f.page);
  for(const value of [{...f.page,predecessorId:uuid(61000)}, {...f.page,requestId:uuid(61001)}, {...f.page,scope:{...scope,workspaceId:uuid(61002)}}])expect(()=>captureRetentionReply(op,value)).toThrow();
 }finally{f.db.close();}
});
it('refuses wrong-key, duplicate, inflated and false-completed status replies',()=>{
 const f=selected();try{
  const key={scope,id:f.page.id};const now=Date.parse(f.input.appliedAt);const status=new RetentionProgress(f.db,f.reads).get(key,now);const op:RetentionOperation={kind:'getWorkspaceRetentionStatus',request:{key,now}};
  expect(captureRetentionReply(op,status)).toEqual(status);
  for(const value of [{...status,id:uuid(61000)}, {...status,items:[status.items[0],status.items[0]]}, {...status,completedCount:1},
   {...status,items:status.items.map(item=>({...item,phase:'settled',fileCount:0,preparedCount:0,absentCount:0,refundedLogicalBytes:Number.MAX_SAFE_INTEGER})),completedCount:3,refundedLogicalBytes:Number.MAX_SAFE_INTEGER},
   {...status,state:'completed',completedAt:'2026-11-14T12:01:00.000Z'}, {...status,extra:true}])expect(()=>captureRetentionReply(op,value)).toThrow();
 }finally{f.db.close();}
});
