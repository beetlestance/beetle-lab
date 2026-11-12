import {constants} from 'node:fs';
import {open,lstat,realpath,opendir,rmdir} from 'node:fs/promises';
import type {BigIntStats} from 'node:fs';
import type {FileHandle} from 'node:fs/promises';
import {join,isAbsolute,normalize} from 'node:path';
import {ProvisionError} from '../types.js';
import {check} from '../src/capture.js';
export const homeNative={open,lstat,realpath,opendir,rmdir};
interface Context {readonly signal:AbortSignal;readonly deadline:number}
interface Identity {readonly uid:number;readonly gid:number}
interface Pin {readonly path:string;readonly handle:FileHandle;readonly info:BigIntStats}
const retained=new Set<object>();
let cleanupFailed=false;
async function closeNative(resource:{close():Promise<void>}):Promise<void>{
 try{await resource.close();}catch(cause){cleanupFailed=true;retained.add(resource);throw new ProvisionError('cleanup',{cause});}
}
const directories=['data','data/config','data/backend','data/backend/inputs','data/backend/inputs/published','data/agent','data/agent/journal','data/agent/staging'];
function safe(value:unknown):asserts value{if(!value)throw new ProvisionError('unsafe_root');}
function creator(info:BigIntStats):boolean{return info.uid===0n&&info.gid===0n&&(info.mode&0o777n)===0o755n;}
function privateOwner(info:BigIntStats,identity:Identity):boolean{return info.uid===BigInt(identity.uid)&&info.gid===BigInt(identity.gid)&&(info.mode&0o777n)===0o700n;}
function printable(path:string):boolean{return [...path].every(character=>{const code=character.charCodeAt(0);return code>=32&&code!==127;});}
function same(a:BigIntStats,b:BigIntStats):boolean{return a.dev===b.dev&&a.ino===b.ino;}
async function entries(path:string,limit:number):Promise<string[]>{
 const directory=await homeNative.opendir(path);const names:string[]=[];
 try{for(let n=0;n<=limit;n++){const item=await directory.read();if(!item)return names;safe(names.length<limit);names.push(item.name);}throw new ProvisionError('unsafe_root');}
 finally{await closeNative(directory);}
}
async function pin(path:string):Promise<Pin>{
 const handle=await homeNative.open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{const info=await handle.stat({bigint:true});safe(info.isDirectory());safe(same(info,await homeNative.lstat(path,{bigint:true}))&&await homeNative.realpath(path)===path);return {path,handle,info};}
 catch(error){await closeNative(handle);throw error;}
}
async function emptyTree(home:string,current:Pin,pins:Pin[]):Promise<void>{
 const names=await entries(current.path,4);
 for(const name of names){const path=join(current.path,name);safe(directories.some(relative=>join(home,relative)===path));
  const child=await pin(path);pins.push(child);safe(pins.length<=directories.length+1);await emptyTree(home,child,pins);
 }
}
/** Held descriptors span root preparation, identity drop and installation. */
export class ComposeHome {
 private readonly pins:Pin[]=[];
 private fresh=false;
 private closing:Promise<void>|undefined;
 private expectedRoot:BigIntStats|undefined;
 private readonly uncertain=new Set<FileHandle>();
 constructor(readonly path:string,private readonly identity:Identity,private readonly context:Context){
  if(cleanupFailed)throw new ProvisionError('cleanup');
  safe(isAbsolute(path)&&normalize(path)===path&&path!=='/'&&Buffer.byteLength(path)<=400&&printable(path));
 }
 async prepare():Promise<void>{
  safe(!this.closing);check(this.context);const info=await homeNative.lstat(this.path,{bigint:true});safe(info.isDirectory()&&!info.isSymbolicLink());this.expectedRoot=info;
  // Existing private homes are inspected only after privilege drop, without repair.
  if(privateOwner(info,this.identity))return;
  safe(creator(info));
  const root=await pin(this.path);safe(same(info,root.info));this.pins.push(root);await emptyTree(this.path,root,this.pins);
  await this.assertPins();
  for(const item of this.pins)safe(creator(item.info));
  // Only the finite, proven-empty Compose mount skeleton is changed.
  for(const item of [...this.pins].reverse()){check(this.context);await item.handle.chown(this.identity.uid,this.identity.gid);await item.handle.chmod(0o700);}
  this.fresh=true;check(this.context);
 }
 async adopt():Promise<boolean>{
  check(this.context);
  if(this.pins.length===0){const root=await pin(this.path);this.pins.push(root);safe(this.expectedRoot&&same(this.expectedRoot,root.info));}
  await this.assertPins(true);
  if(!this.fresh){const names=await entries(this.path,2);safe(names.length===2&&names.includes('data')&&names.includes('bootstrap.sqlite'));}
  return this.fresh;
 }
 async clearEmptySkeleton():Promise<void>{
  safe(this.fresh);await this.assertPins(true);
  for(const item of [...this.pins].slice(1).reverse()){
   check(this.context);safe((await entries(item.path,1)).length===0);safe(same(item.info,await homeNative.lstat(item.path,{bigint:true})));
   await homeNative.rmdir(item.path);await this.closeOne(item.handle);this.pins.splice(this.pins.indexOf(item),1);
  }
  await this.pins[0]!.handle.sync();check(this.context);
 }
 async assertPins(owned=false):Promise<void>{
  check(this.context);
  for(const item of this.pins){const actual=await homeNative.lstat(item.path,{bigint:true});safe(same(actual,item.info)&&await homeNative.realpath(item.path)===item.path);
   if(owned)safe(actual.uid===BigInt(this.identity.uid)&&actual.gid===BigInt(this.identity.gid)&&(actual.mode&0o777n)===0o700n);
  }
 }
 private async closeOne(handle:FileHandle):Promise<void>{
  try{await closeNative(handle);}catch(cause){this.uncertain.add(handle);retained.add(this);retained.add(handle);throw new ProvisionError('cleanup',{cause});}
 }
 close():Promise<void>{this.closing??=this.drain();return this.closing;}
 private async drain():Promise<void>{
  const results=await Promise.allSettled(this.pins.filter(item=>!this.uncertain.has(item.handle)).map(item=>this.closeOne(item.handle)));
  if(cleanupFailed||this.uncertain.size||results.some(result=>result.status==='rejected'))throw new ProvisionError('cleanup');
 }
}
