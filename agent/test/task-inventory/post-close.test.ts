import { expect,it } from 'vitest';
import { mkdir,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
const f=fixture();
it('rejects role replacement during original installed-root close before publishing an observed plan',async()=>{
 const e=await f.inventory();const output=join(e.task,'output');let swapped=false;
 const ports={...e.ports,open:async(...args:Parameters<typeof e.ports.open>)=>{const handle=await e.ports.open(...args);const close=handle.close.bind(handle);
  if(String(args[0])===e.root.directory)handle.close=async()=>{await close();await rename(output,`${output}-old`);await mkdir(output,{mode:0o700});swapped=true;};return handle;}};
 const work=e.inventory.prepareWithPorts(e.token,{deadline:performance.now()+10000},ports);expect(await work.result).toEqual({ok:false,reason:'custody'});await work.quiesced;
 expect(swapped).toBe(true);expect(e.closed.length).toBe(e.opened.length);await rm(output,{recursive:true});await rename(`${output}-old`,output);
});
