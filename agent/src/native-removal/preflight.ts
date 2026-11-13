import { encodeCanonicalJson } from '@beetle/contracts';
import type { CleanupEntry } from '../cleanup-control/index.js';
import type { OutputIO } from '../collection/output/index.js';
import { InventoryTree } from '../task-inventory/index.js';
import { InventoryRoot } from '../task-inventory/index.js';
import { requireInventory } from '../task-inventory/index.js';
import type { InventoryPorts } from '../task-inventory/index.js';
import type { NativeStepState } from './types.js';
export function missing(error:unknown):boolean{return !!error&&typeof error==='object'&&Object.getOwnPropertyDescriptor(error,'code')?.value==='ENOENT';}
export async function absent(path:string,io:OutputIO,ports:InventoryPorts):Promise<boolean>{
 try{await io.io(()=>ports.lstat(path,{bigint:true}));return false;}catch(error){io.check();if(missing(error))return true;throw error;}
}
function complete(input:NativeStepState,actual:readonly CleanupEntry[]):void{
 const remaining=input.plan.entries.slice(0,input.plan.entries.length-input.progress.removedCount);const next=remaining.at(-1);const tolerate=input.allowMissing&&input.progress.state==='cleaning';
 const byPath=new Map(remaining.map(row=>[row.path,row]));const seen=new Set<string>();
 for(const row of actual){const expected=byPath.get(row.path);requireInventory(expected&&encodeCanonicalJson(row,8192)===encodeCanonicalJson(expected,8192));seen.add(row.path);}
 for(const row of remaining)requireInventory(seen.has(row.path)||tolerate&&row.path===next?.path);
 requireInventory(actual.length===remaining.length||tolerate&&actual.length===remaining.length-1);
}
export async function preflight(input:NativeStepState,io:OutputIO,ports:InventoryPorts):Promise<void>{
 const root=new InventoryRoot(input.installation,io,ports);const parent=await root.open();let isAbsent:boolean;
 try{const name=input.directory.slice(input.directory.lastIndexOf('/')+1);isAbsent=await absent(ports.child(parent,name),io,ports);}
 finally{await io.closeHandles([parent]);}
 if(isAbsent){requireInventory(input.progress.state==='files_absent'||input.allowMissing&&input.progress.state==='cleaning'&&input.progress.removedCount===input.plan.entries.length-1);await root.namedCheck();return;}
 requireInventory(input.progress.state==='prepared'||input.progress.state==='cleaning');
 const tree=new InventoryTree(input.directory,input.root,io,ports,input.installation);complete(input,await tree.read());io.check();
}
