import { expect,it } from 'vitest';
import { fixture } from '../cleanup-plans/fixtures.js';
import { loseReply } from '../source-journal/fixtures.js';
const f=fixture();
it('durably enters cleaning without resetting progress and refuses skips/rollback or changed plan',async()=>{
 const e=await f.prepared();await e.inventory.persist(e.observed,{deadline:performance.now()+10000});expect(await e.owner.cleanupProgress.read(e.plan)).toBeNull();
 const prepared=await e.owner.cleanupProgress.begin(e.plan);expect(prepared).toMatchObject({state:'prepared',removedCount:0,version:1});const first=await e.owner.cleanupProgress.advance(e.plan,{...prepared,state:'cleaning',version:2});expect(first).toMatchObject({state:'cleaning',removedCount:0,version:2});
 const next={...first,removedCount:1,version:3};expect(await e.owner.cleanupProgress.advance(e.plan,next)).toEqual(next);
 expect(await e.owner.cleanupProgress.begin(e.plan)).toEqual(next);expect(await e.owner.cleanupProgress.advance(e.plan,next)).toEqual(next);
 await expect(e.owner.cleanupProgress.advance(e.plan,first)).rejects.toMatchObject({code:'conflict'});
 await expect(e.owner.cleanupProgress.advance(e.plan,{...next,removedCount:3,version:5})).rejects.toMatchObject({code:'conflict'});
});
it('recovers actual committed progress after lost reply/termination/reopen and keeps the same plan',async()=>{
 const e=await f.prepared();await e.inventory.persist(e.observed,{deadline:performance.now()+10000});const prepared=await e.owner.cleanupProgress.begin(e.plan);expect(prepared).toMatchObject({state:'prepared',removedCount:0,version:1});const first=await e.owner.cleanupProgress.advance(e.plan,{...prepared,state:'cleaning',version:2});const next={...first,removedCount:1,version:3};
 await loseReply(e.owner,()=>e.owner.cleanupProgress.advance(e.plan,next));await e.owner.cleanupProgress.settleCarrier();const journal=await f.open(e.journalPath);
 expect(await journal.cleanupProgress.read(e.plan)).toEqual(next);expect(await journal.cleanupProgress.advance(e.plan,next)).toEqual(next);await journal.close();
});
