import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { CleanupEntry } from '../cleanup-control/index.js';
import type { OutputIO } from '../collection/output/index.js';
import { InventoryRoot } from '../task-inventory/index.js';
import { entry,nativeFact,requireInventory,sameNative,signature } from '../task-inventory/index.js';
import type { InventoryPorts } from '../task-inventory/index.js';
import type { NativeStepState } from './types.js';
import { absent } from './preflight.js';
export interface RemovalPorts extends InventoryPorts{unlink(path:string):Promise<void>;rmdir(path:string):Promise<void>}
interface Parent{readonly handle:FileHandle;readonly path:string;readonly expected:CleanupEntry;readonly stat:BigIntStats}
export class StepFiles{
 private readonly root:InventoryRoot;private readonly parents:Parent[]=[];private mountId:string|undefined;
 constructor(private readonly input:NativeStepState,private readonly io:OutputIO,private readonly ports:RemovalPorts){this.root=new InventoryRoot(input.installation,io,ports);}
 async remove():Promise<void>{
  const installed=await this.root.open();this.mountId=await this.io.io(()=>this.ports.mount(installed,this.io));
  const next=this.input.plan.entries[this.input.plan.entries.length-this.input.progress.removedCount-1];
  const relative=next?.path??'';
  const {parent,leaf}=await this.parent(installed,relative);const path=this.ports.child(parent,leaf);
  const wasAbsent=await absent(path,this.io,this.ports);
  if(!next){requireInventory(this.input.progress.state==='files_absent'&&wasAbsent);}
  else if(wasAbsent){requireInventory(this.input.allowMissing&&this.input.progress.state==='cleaning');await this.checkParents(true);}
  else await this.unlink(parent,path,next);
  await this.io.io(()=>parent.sync());await this.root.namedCheck();await this.checkParents(false);
 }
 private async parent(installed:FileHandle,relative:string):Promise<{parent:FileHandle;leaf:string}>{
  const taskName=this.input.directory.slice(this.input.directory.lastIndexOf('/')+1);
  if(relative==='')return{parent:installed,leaf:taskName};
  let parent=installed;let parentPath=this.input.installation.directory;const pieces=relative.split('/');
  for(const piece of [taskName,...pieces.slice(0,-1)]){
   parentPath=join(parentPath,piece);const planPath=parentPath===this.input.directory?'':parentPath.slice(this.input.directory.length+1);
   const expected=this.input.plan.entries.find(row=>row.path===planPath);requireInventory(expected?.kind==='directory');
   const opened=await this.open(this.ports.child(parent,piece),expected);this.parents.push({handle:opened.handle,path:parentPath,expected,stat:opened.stat});parent=opened.handle;
  }
  return{parent,leaf:pieces.at(-1)!};
 }
 private async open(path:string,expected:CleanupEntry){
  const flags=constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|(expected.kind==='directory'?constants.O_DIRECTORY:0);
  const handle=await this.io.io(()=>this.ports.open(path,flags).then(value=>{this.io.own(value);return value;}));
  const stat=await this.io.io(()=>handle.stat({bigint:true}));this.matches(expected,stat);
  requireInventory(await this.io.io(()=>this.ports.mount(handle,this.io))===this.mountId);return{handle,stat};
 }
 private matches(expected:CleanupEntry,stat:BigIntStats):void{
  requireInventory(encodeCanonicalJson(entry(expected.path,stat,this.input.root),8192)===encodeCanonicalJson(expected,8192));
 }
 private async unlink(parent:FileHandle,path:string,next:CleanupEntry):Promise<void>{
  const opened=await this.open(path,next);await this.root.namedCheck();await this.checkParents(true);
  const stat=await this.io.io(()=>opened.handle.stat({bigint:true}));requireInventory(signature(stat)===signature(opened.stat));
  const named=await this.io.io(()=>this.ports.lstat(path,{bigint:true}));requireInventory(signature(named)===signature(stat));this.io.check();
  await this.io.io(()=>next.kind==='file'?this.ports.unlink(path):this.ports.rmdir(path));
  requireInventory(await absent(this.ports.child(parent,path.slice(path.lastIndexOf('/')+1)),this.io,this.ports));
 }
 private async checkParents(unchanged:boolean):Promise<void>{
  for(const parent of this.parents){const stat=await this.io.io(()=>parent.handle.stat({bigint:true}));this.matches(parent.expected,stat);
   const named=await this.io.io(()=>this.ports.lstat(parent.path,{bigint:true}));requireInventory(sameNative(nativeFact(named),nativeFact(stat)));
   if(unchanged)requireInventory(signature(stat)===signature(parent.stat)&&signature(named)===signature(parent.stat));}
 }
 async afterClose():Promise<void>{
  await this.root.namedCheck();
  for(const parent of this.parents){const named=await this.io.io(()=>this.ports.lstat(parent.path,{bigint:true}));this.matches(parent.expected,named);}
  const next=this.input.plan.entries[this.input.plan.entries.length-this.input.progress.removedCount-1];
  const path=next?.path?join(this.input.directory,next.path):this.input.directory;
  // Named absence is accepted only after exact surviving parent identities and original closes.
  requireInventory(dirname(path)===this.input.installation.directory||this.parents.some(parent=>parent.path===dirname(path)));
  requireInventory(await absent(path,this.io,this.ports));
 }
}
