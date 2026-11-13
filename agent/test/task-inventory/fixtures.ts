import { open, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fixture as runtimeFixture } from '../runtime-retirement/fixtures.js';
import { retirementRoot } from '../../src/staging/index.js';
import { TaskInventory } from '../../src/task-inventory/index.js';
import { inventoryPorts } from '../../src/task-inventory/ports.js';
import type { InventoryPorts } from '../../src/task-inventory/ports.js';
import type { FileHandle } from 'node:fs/promises';
import { afterEach } from 'vitest';
export function portablePorts() {
 const handles=new Map<FileHandle,string>();const opened:string[]=[];const closed:string[]=[];
 const ports:InventoryPorts={platform:'linux',lstat,realpath,
  open:async(...args:Parameters<typeof open>)=>{const handle=await open(...args);const path=String(args[0]);handles.set(handle,path);opened.push(path);
   const close=handle.close.bind(handle);handle.close=async()=>{closed.push(path);await close();};return handle;},
  child:(handle,name)=>name===undefined?handles.get(handle)!:join(handles.get(handle)!,name),
  directory:inventoryPorts.directory,mount:async()=> 'synthetic-mount'};
 return{ports,opened,closed,handles};
}
export function fixture(){
 const f=runtimeFixture();const owners:TaskInventory[]=[];afterEach(async()=>{await Promise.allSettled(owners.map(owner=>owner.close()));});
 return{...f,async inventory(){const e=await f.ready();const token=await e.runtime.retire(e.producer,{deadline:performance.now()+10000});
  const owner=new TaskInventory({journal:e.owner,root:e.staging.root});owners.push(owner);
  const root=retirementRoot(e.staging.root);const task=join(root.directory,e.plan.name);const p=portablePorts();
  return{...e,token,inventory:owner,task,root,...p,parent:dirname(task)};
 }};
}
