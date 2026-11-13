import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
import { NativeReceipt } from '../../src/native-receipt/index.js';
import { nativeAbsenceFacts } from '../../src/native-removal/index.js';
import type { NativeAbsenceObservation } from '../../src/native-removal/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('does not turn final metadata progress into a receipt while the actual task still exists',async()=>{
 const e=await f.ready();const owner=new NativeReceipt({journal:e.owner,root:e.staging.root,removal:e.removal});
 try{
  await expect(owner.finalizeWithPorts(e.token,operation(),e.ports)).rejects.toMatchObject({reason:'custody'});expect(e.effects).toHaveLength(0);
  let progress=await e.owner.cleanupProgress.begin(e.plan);progress=await e.owner.cleanupProgress.advance(e.plan,{...progress,state:'cleaning',version:2});
  for(let n=1;n<=e.plan.entries.length;n++)progress=await e.owner.cleanupProgress.advance(e.plan,{...progress,removedCount:n,version:n+2,state:n===e.plan.entries.length?'files_absent':'cleaning'});
  await expect(owner.finalizeWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);expect(await e.owner.cleanupReceipts.read(e.plan)).toBeNull();
 }finally{await owner.close();}
});
it('authenticates opaque absence against exact physical ports and the actual live native owner',async()=>{
 const e=await f.completed();const observed=await e.removal.stepWithProofAndPorts(e.token,operation(),e.ports);expect(observed.absence).toBeTruthy();if(!observed.absence)throw Error('Missing real native observation');
 const ports={retirements:e.owner.retirements,plans:e.owner.cleanupPlans,progress:e.owner.cleanupProgress,receipts:e.owner.cleanupReceipts};
 expect(()=>nativeAbsenceFacts({} as NativeAbsenceObservation,ports)).toThrow();expect(nativeAbsenceFacts(observed.absence,ports).receipt.planIdentity).toHaveLength(64);
 const other=await f.completed();expect(()=>nativeAbsenceFacts(observed.absence!,{retirements:other.owner.retirements,plans:other.owner.cleanupPlans,progress:other.owner.cleanupProgress,receipts:other.owner.cleanupReceipts})).toThrow();
 await e.removal.close();expect(()=>nativeAbsenceFacts(observed.absence!,ports)).toThrow();
});
it('refuses receipt when a fresh native original close fails, even after earlier final progress and proof',async()=>{
 const e=await f.completed();const ports={...e.ports,open:async(...args:Parameters<typeof e.ports.open>)=>{const handle=await e.ports.open(...args);const close=handle.close.bind(handle);
  handle.close=async()=>{await close();throw Error('synthetic final native close failure');};return handle;}};
 await expect(e.receipt.finalizeWithPorts(e.token,operation(),ports)).rejects.toMatchObject({reason:'io'});expect(await e.owner.cleanupReceipts.read(e.plan)).toBeNull();
 await expect(e.receipt.finalizeWithPorts(e.token,operation(),e.ports)).rejects.toMatchObject({reason:'io'});expect(await e.owner.cleanupReceipts.read(e.plan)).toBeNull();
});
