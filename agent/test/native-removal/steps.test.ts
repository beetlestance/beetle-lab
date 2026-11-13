import { expect,it } from 'vitest';
import { lstat,writeFile,rm,mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('removes exactly one reverse-plan file/directory per durable step and proves final root absence without refund',async()=>{
 const e=await f.ready();const expected=e.plan.entries.map(row=>row.path).reverse();const reservation=await e.owner.admission({kind:'reservation',key:e.key});
 for(let n=0;n<expected.length;n++){
  const progress=await e.removal.stepWithPorts(e.token,operation(),e.ports);expect(progress.removedCount).toBe(n+1);expect(progress.version).toBe(n+3);
  expect(e.effects).toHaveLength(n+1);expect(e.effects[n]).toBe(expected[n]?join(e.task,expected[n]!):e.task);
 }
 const progress=await e.owner.cleanupProgress.read(e.plan);expect(progress?.state).toBe('files_absent');await expect(lstat(e.task)).rejects.toMatchObject({code:'ENOENT'});
 expect(await e.removal.stepWithPorts(e.token,operation(),e.ports)).toEqual(progress);expect(e.effects).toHaveLength(expected.length);
 expect(await e.owner.admission({kind:'reservation',key:e.key})).toEqual(reservation);expect(await e.owner.cleanupPlans.read(e.key)).not.toBeNull();
});
it('reconciles only the exact next uncertain missing entry after actual unlink promise failure',async()=>{
 const e=await f.ready();let failed=false;const ports={...e.ports,rmdir:async(path:string)=>{await e.ports.rmdir(path);if(!failed){failed=true;throw Error('synthetic committed rmdir reply loss');}}};
 await expect(e.removal.stepWithPorts(e.token,operation(),ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(1);expect((await e.owner.cleanupProgress.read(e.plan))?.removedCount).toBe(0);
 expect((await e.removal.stepWithPorts(e.token,operation(),e.ports)).removedCount).toBe(1);expect(e.effects).toHaveLength(1);
});
it('refuses a missing non-next entry or unexpected file before any unlink',async()=>{
 const e=await f.ready();const file=e.plan.entries.find(row=>row.kind==='file')!;await rm(join(e.task,file.path));
 await expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);
});
it('refuses post-plan extra entries and root disappearance before its final turn',async()=>{
 const e=await f.ready();await writeFile(join(e.task,'output','unexpected'),'extra',{mode:0o600});
 await expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);
 await rm(e.task,{recursive:true});await expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);
});
it('refuses reappearance of an already removed entry before a subsequent effect',async()=>{
 const e=await f.ready();expect((await e.removal.stepWithPorts(e.token,operation(),e.ports)).removedCount).toBe(1);
 const removed=e.plan.entries.at(-1)!;const path=join(e.task,removed.path);await mkdir(path,{mode:0o700});
 await expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(1);
});

it('requires every prepared entry including the next leaf before first committing cleaning',async()=>{
 const e=await f.ready();const next=e.plan.entries.at(-1)!;await rm(join(e.task,next.path),{recursive:true});
 await expect(e.removal.stepWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(e.effects).toHaveLength(0);
 expect(await e.owner.cleanupProgress.read(e.plan)).toMatchObject({state:'prepared',removedCount:0,version:1});
});
it('refuses unsupported native platforms before opening task files or committing cleaning',async()=>{
 const e=await f.ready();const opened=e.opened.length;await expect(e.removal.stepWithPorts(e.token,operation(),{...e.ports,platform:'darwin'})).rejects.toBeTruthy();
 expect(e.effects).toHaveLength(0);expect(e.opened).toHaveLength(opened);expect(await e.owner.cleanupProgress.read(e.plan)).toMatchObject({state:'prepared',version:1});
});
