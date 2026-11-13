import { expect,it } from 'vitest';
import { lstat,mkdir } from 'node:fs/promises';
import { fixture } from './fixtures.js';
import { captureOutputRetirementReply } from '@beetle/contracts/output-retirement';
import { retirementDigest } from '../../src/retirement-values/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('composes real Journal/files/native proof through a cleaned bound reply and revalidates receipt replay',async()=>{
 const e=await f.pipeline();const before={creates:e.backend.creates,starts:e.backend.starts};
 const work=e.pipeline.tickWithPorts(e.request,operation(),e.ports);const reply=await work.result;await work.settled;
 expect(captureOutputRetirementReply(reply,e.request,retirementDigest)).toMatchObject({state:'cleaned',preparationIdentity:expect.stringMatching(/^[a-f0-9]{64}$/)});
 await expect(lstat(e.task)).rejects.toMatchObject({code:'ENOENT'});const effects=e.effects.length;
 const replay=e.pipeline.tickWithPorts(e.request,operation(),e.ports);expect(await replay.result).toEqual(reply);await replay.settled;expect(e.effects).toHaveLength(effects);
 expect({creates:e.backend.creates,starts:e.backend.starts}).toEqual(before);expect(await e.owner.cleanupReceipts.read((await e.owner.cleanupPlans.read(e.key))!.plan)).not.toBeNull();
 await mkdir(e.task,{mode:0o700});const invalid=e.pipeline.tickWithPorts(e.request,operation(),e.ports);await expect(invalid.result).rejects.toBeTruthy();await expect(invalid.settled).rejects.toBeTruthy();
});
it('returns pending only after a bounded batch and continues the same stored plan without another engine',async()=>{
 const e=await f.pipeline(1);const first=e.pipeline.tickWithPorts(e.request,operation(),e.ports);expect((await first.result).state).toBe('pending');await first.settled;expect(e.effects).toHaveLength(1);
 let state='pending';for(let n=0;n<16&&state==='pending';n++){const work=e.pipeline.tickWithPorts(e.request,operation(),e.ports);state=(await work.result).state;await work.settled;}
 expect(state).toBe('cleaned');expect(e.effects).toHaveLength((await e.owner.cleanupPlans.read(e.key))!.plan.entries.length);
});
it('rejects malformed/conflicting requests and deadlines as failures, not pending/cleaned claims',async()=>{
 const e=await f.pipeline();const bad=e.pipeline.tickWithPorts({...e.request,path:'/wrong'},operation(),e.ports);await expect(bad.result).rejects.toBeTruthy();await expect(bad.settled).rejects.toBeTruthy();
 const conflict=e.pipeline.tickWithPorts({...e.request,deletionId:'00000000-0000-4000-8000-000000000999'},operation(),e.ports);await expect(conflict.result).rejects.toMatchObject({reason:'conflict'});await expect(conflict.settled).rejects.toBeTruthy();
 const expired=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()-1},e.ports);await expect(expired.result).rejects.toMatchObject({reason:'deadline'});await expect(expired.settled).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);
});
