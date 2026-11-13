import { describe,it,expect } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureRetentionSnapshot,captureRetentionProgress,RETENTION_SNAPSHOT_BODY_BYTES,RETENTION_SNAPSHOT_BYTES } from '../../src/domain/retention/index.js';
import type { RetentionSnapshot } from '../../src/domain/retention/index.js';
const id=(n:number)=>`ffffffff-ffff-4fff-bfff-${n.toString(16).padStart(12,'0')}`;
const maximum=Number.MAX_SAFE_INTEGER;
function snapshot(count=100):RetentionSnapshot{
 return{version:1,id:id(1),kind:'retention',scope:{kind:'workspace',organizationId:id(2),workspaceId:id(3)},requestId:id(4),intentDigest:'f'.repeat(64),
  capturedAt:'2026-11-14T12:00:00.000Z',expiresAt:'2026-11-14T12:15:00.000Z',settings:{installation:{id:id(5),version:maximum},organization:{id:id(6),version:maximum},workspace:{id:id(7),version:maximum}},
  policy:{mode:'enabled',ageDays:365000,completedRunCount:maximum,storageBytes:maximum},policySource:{kind:'workspace',organizationId:id(2),workspaceId:id(3)},epoch:maximum,
  predecessorId:id(8),before:{completedCount:maximum-count,logicalBytes:0},after:{completedCount:maximum,logicalBytes:maximum},scanned:count,
  cursor:{requestedAt:'2026-11-14T12:00:00.000Z',id:id(9)},hasMore:true,
  candidates:Array.from({length:count},(_,i)=>({id:id(100+i*3),version:maximum,estimatedBytes:Math.floor(maximum/Math.max(count,1)),reason:'completed_count',deletionId:id(101+i*3),requestId:id(102+i*3)})),exclusions:[]};
}
describe('immutable retention snapshot representation',()=>{
 it('fits maximum-width membership, progress bodies and row allowances inside actual reservation',()=>{
  const body=captureRetentionSnapshot(snapshot());const encoded=encodeCanonicalJson(body,RETENTION_SNAPSHOT_BODY_BYTES);
  expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(32768);
  const progress=captureRetentionProgress({phase:'blocked',preparedCount:128,absentCount:128,fileCount:128,error:'capacity_unavailable'});
  expect(Buffer.byteLength(encodeCanonicalJson(progress,256))).toBeLessThanOrEqual(256);
  expect(32768+100*(512+256)+8192).toBeLessThanOrEqual(RETENTION_SNAPSHOT_BYTES);
  expect(Object.isFrozen(body.candidates[0])).toBe(true);
 });
 it('binds policy source and lifetime; refuses duplicate/cross-identity members and arithmetic overflow',()=>{
  const base=snapshot(2);
  const cases=[{...base,expiresAt:'2026-11-14T12:15:00.001Z'}, {...base,policySource:{kind:'organization',organizationId:id(999)}},
   {...base,candidates:[base.candidates[0],base.candidates[0]]}, {...base,candidates:base.candidates.map(item=>({...item,estimatedBytes:maximum}))},
   {...base,after:{...base.after,completedCount:base.before.completedCount-1}}, {...base,scanned:1}, {...base,cursor:null}, {...base,cursor:{id:id(9),requestedAt:'2026-11-14T12:00:60.000Z'}},
   {...base,cursor:{id:id(9),requestedAt:'2026-11-14t12:00:00.000z'}}];
  for(const value of cases)expect(()=>captureRetentionSnapshot(value)).toThrow();
 });
 it('keeps unknown byte prefixes unknown, bounds exclusions and refuses mixed manual membership',()=>{
  const base=snapshot(1);
  expect(()=>captureRetentionSnapshot({...base,before:{...base.before,logicalBytes:null}})).toThrow();
  expect(()=>captureRetentionSnapshot({...base,exclusions:[{reason:'pinned',count:1,estimatedBytes:1}]})).toThrow();
  expect(()=>captureRetentionSnapshot({...base,candidates:[{...base.candidates[0],reason:'manual'}]})).toThrow();
  const manual={...base,kind:'manual',predecessorId:null,hasMore:false,candidates:[{...base.candidates[0],reason:'manual'}]};
  expect(captureRetentionSnapshot(manual).kind).toBe('manual');
 });
 it('never treats incomplete progress or arbitrary error text as settlement',()=>{
  for(const value of [{phase:'settled',preparedCount:128,absentCount:127,fileCount:128,error:null},
   {phase:'backend_files',preparedCount:1,absentCount:2,fileCount:2,error:null},
   {phase:'blocked',preparedCount:0,absentCount:0,fileCount:0,error:null},
   {phase:'blocked',preparedCount:0,absentCount:0,fileCount:0,error:'arbitrary log data'}])expect(()=>captureRetentionProgress(value)).toThrow();
 });
});

it('fits maximum-width immutable parent context without changing existing canonical snapshots',()=>{
 const base=snapshot();const old=encodeCanonicalJson(captureRetentionSnapshot(base),32768);expect(JSON.parse(old)).not.toHaveProperty('traversal');
 const traversal={scope:{kind:'installation'},horizon:{...base.scope,workspaceId:id(9999)},nextWorkspace:{...base.scope,workspaceId:id(999)},previousSnapshotId:base.predecessorId};
 const stored=captureRetentionSnapshot({...base,traversal});expect(Buffer.byteLength(encodeCanonicalJson(stored,32768))).toBeLessThanOrEqual(32768);expect(Object.isFrozen(stored.traversal)).toBe(true);
 for(const invalid of [{...traversal,scope:base.scope},{...traversal,horizon:{...base.scope,workspaceId:id(1)}},{...traversal,nextWorkspace:base.scope},{...traversal,previousSnapshotId:base.id},{...traversal,extra:true}])expect(()=>captureRetentionSnapshot({...base,traversal:invalid})).toThrow();
});
