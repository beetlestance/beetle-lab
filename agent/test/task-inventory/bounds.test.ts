import { expect,it } from 'vitest';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('refuses complete-plan entry flood and closes every issued original without deleting files',async()=>{
 const e=await f.inventory();const paths=Array.from({length:505},(_,n)=>join(e.task,'output',`entry-${n}`));
 for(const path of paths)await writeFile(path,'x',{mode:0o600});
 const work=e.inventory.prepareWithPorts(e.token,operation(),e.ports);expect(await work.result).toEqual({ok:false,reason:'output_limit'});await work.quiesced;
 expect(e.closed.length).toBe(e.opened.length);
});
it('refuses over-depth inventory without opening the overflowing child',async()=>{
 const e=await f.inventory();let parent=join(e.task,'output');for(let n=0;n<32;n++){parent=join(parent,'nested');await mkdir(parent,{mode:0o700});}
 const work=e.inventory.prepareWithPorts(e.token,operation(),e.ports);expect(await work.result).toEqual({ok:false,reason:'output_limit'});await work.quiesced;
 expect(e.opened.includes(parent)).toBe(false);expect(e.closed.length).toBe(e.opened.length);
});
it('refuses invalid UTF8 enumeration rather than replacing names',async()=>{
 const e=await f.inventory();const ports={...e.ports,directory:async()=>({read:async()=>({name:Buffer.from([0xff])}),close:async()=>undefined})};
 const work=e.inventory.prepareWithPorts(e.token,operation(),ports);expect(await work.result).toEqual({ok:false,reason:'custody'});await work.quiesced;expect(e.closed.length).toBe(e.opened.length);
});
it('refuses serialized plan overflow even when entry/depth limits fit',async()=>{
 const e=await f.inventory();const parent=join(e.task,'output','n'.repeat(200));await mkdir(parent,{mode:0o700});
 for(let n=0;n<350;n++)await writeFile(join(parent,`${String(n).padStart(3,'0')}-${'f'.repeat(190)}`),'x',{mode:0o600});
 const work=e.inventory.prepareWithPorts(e.token,operation(),e.ports);expect(await work.result).toMatchObject({ok:false});await work.quiesced;expect(e.closed.length).toBe(e.opened.length);
});
