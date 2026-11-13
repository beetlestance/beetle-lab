import { it,expect } from 'vitest';
import { history,command,scope,uuid } from './selection-fixture.js';
import { otherWorkspace,usage } from './fixture.js';
import { RetentionProgress } from '../../src/adapters/outbound/sqlite/retention-progress/index.js';
import { captureRetentionOperation,captureRetentionReply,retentionReplyLimit } from '../../src/adapters/outbound/sqlite/retention-wire/index.js';
it('lists the eight charged workspace batches without changing ownership or inferring native progress',()=>{
 const f=history(1);try{
  f.policy(values=>{values.retention={mode:'enabled',ageDays:1};});const pages=Array.from({length:8},(_,i)=>f.retention.preview(command(f,i)));
  const before=usage(f.db);const progress=new RetentionProgress(f.db,f.reads);const value=progress.list(scope);
  expect(value.items).toHaveLength(8);expect(value.items.map(item=>item.id)).toEqual(pages.map(page=>page.id).reverse());
  expect(value.items.every(item=>item.state==='preview'&&item.completedAt===null&&item.candidateCount===1)).toBe(true);expect(usage(f.db)).toBe(before);
  const op={kind:'listWorkspaceRetention' as const,request:{scope}};expect(retentionReplyLimit(op)).toBe(8192);expect(captureRetentionOperation({...op,messageId:1})).toEqual(op);expect(captureRetentionReply(op,value)).toEqual(value);
  const receipt=progress.discard({scope,id:pages[0]!.id},Date.parse('2026-11-14T12:01:00.000Z'));expect(receipt.refundedLogicalBytes).toBe(131072);expect(progress.list(scope).items).toHaveLength(7);expect(usage(f.db)).toBe(Number(before)-131072);
 }finally{f.db.close();}
});
it('does not disclose another workspace batch or accept duplicated or forged inventory replies',()=>{
 const f=history(1);try{
  f.retention.preview(command(f));const target=otherWorkspace(f);const progress=new RetentionProgress(f.db,f.reads);expect(progress.list(target)).toEqual({scope:target,items:[]});
  expect(()=>progress.list({...scope,workspaceId:uuid(64000)})).toThrow('not_found');const value=progress.list(scope);const op={kind:'listWorkspaceRetention' as const,request:{scope}};
  const item=value.items[0]!;for(const forged of [{...value,scope:target},{...value,items:[item,item]},{...value,items:[{...item,scope:target}]},{...value,items:[{...item,state:'completed'}]},{...value,extra:true}])expect(()=>captureRetentionReply(op,forged)).toThrow();
  expect(()=>captureRetentionOperation({...op,request:{scope,now:0}})).toThrow();
 }finally{f.db.close();}
});
