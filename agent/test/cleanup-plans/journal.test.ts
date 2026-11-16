import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { nativeCleanupPlanIdentity, captureStoredCleanupPlan } from '../../src/cleanup-control/index.js';
import { loseReply } from '../source-journal/fixtures.js';
const f=fixture();
it('persists actual post-close observation through genuine private composition with exact immutable replay',async()=>{
 const e=await f.prepared();const expected=nativeCleanupPlanIdentity(e.plan);expect(await e.owner.cleanupPlans.read(e.key)).toBeNull();
 const stored=await e.inventory.persist(e.observed,{deadline:performance.now()+10000});expect(stored.planIdentity).toBe(expected);expect(stored.plan).toEqual(e.plan);
 expect(await e.inventory.persist(e.observed,{deadline:performance.now()+10000})).toEqual(stored);expect(await e.owner.cleanupPlans.read(e.key)).toEqual(stored);
 const changed={...e.plan,entries:[...e.plan.entries,{path:'z',kind:'file' as const,native:{...e.plan.entries[0]!.native,ino:'999999999',mode:String(0o100600),bytes:'0',links:'1' as const}}]};
 await expect(e.owner.cleanupPlans.store(changed)).rejects.toMatchObject({code:'conflict'});
 await e.inventory.close();await expect(e.inventory.persist(e.observed,{deadline:performance.now()+10000})).rejects.toMatchObject({reason:'closed'});
});
it('recovers a committed plan after lost reply/actual carrier termination and reopens exact metadata',async()=>{
 const e=await f.prepared();const raw=await loseReply(e.owner,()=>e.owner.cleanupPlans.store(e.plan));await e.owner.cleanupPlans.settleCarrier();
 if(!raw||typeof raw!=='object'||!('stored' in raw))throw Error('Missing actual committed reply');const expected=captureStoredCleanupPlan(raw.stored);
 const journal=await f.open(e.journalPath);expect(await journal.cleanupPlans.read(e.key)).toEqual(expected);expect(await journal.cleanupPlans.store(e.plan)).toEqual(expected);
 await journal.close();
});
it.each(['namespace','task','request','role','scope'] as const)('refuses changed %s metadata without persisting another plan',async kind=>{
 const e=await f.prepared();const plan={...e.plan,
  ...(kind==='namespace'?{namespaceIdentity:'f'.repeat(64)}:{}),...(kind==='task'?{taskNamespaceIdentity:'f'.repeat(64)}:{}),
  ...(kind==='request'?{retirementRequestDigest:'f'.repeat(64)}:{}),
  ...(kind==='scope'?{original:{...e.plan.original,workspaceId:'00000000-0000-4000-8000-000000000999'}}:{}),
  ...(kind==='role'?{entries:e.plan.entries.map(row=>row.path==='output'&&row.kind==='directory'?{...row,native:{...row.native,ino:'999999999'}}:row)}:{})};
 await expect(e.owner.cleanupPlans.store(plan)).rejects.toMatchObject({code:kind==='scope'?'not_found':'conflict'});expect(await e.owner.cleanupPlans.read(e.key)).toBeNull();
});
it('does not persist forged observation or an observation after its producer owner is revoked',async()=>{
 const e=await f.prepared();await expect(e.inventory.persist({} as typeof e.observed,{deadline:performance.now()+10000})).rejects.toMatchObject({reason:'custody'});
 await e.coordinator.close();await expect(e.inventory.persist(e.observed,{deadline:performance.now()+10000})).rejects.toBeTruthy();expect(await e.owner.cleanupPlans.read(e.key)).toBeNull();
});
