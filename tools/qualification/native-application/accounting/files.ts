import assert from 'node:assert/strict';
import {constants} from 'node:fs';
import {open,opendir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export interface Budget {entries:number;bytes:number;deadline:number}
export interface Leaf {bytes:number;sha256:string}
async function leaf(path:string,budget:Budget):Promise<Leaf>{
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat({bigint:true});assert(before.isFile()&&before.nlink===1n&&before.size<=8388608n&&before.uid===BigInt(process.getuid!()));
  budget.bytes+=Number(before.size);assert(budget.bytes<=100663296);const hash=createHash('sha256');let bytes=0;
  for await(const chunk of file.createReadStream({autoClose:false,highWaterMark:65536})){bytes+=chunk.length;assert(bytes<=Number(before.size)&&performance.now()<budget.deadline);hash.update(chunk);}
  assert.equal(bytes,Number(before.size));const after=await file.stat({bigint:true});
  for(const key of ['dev','ino','size','uid','gid','mode','nlink','mtimeNs','ctimeNs'] as const)assert.equal(after[key],before[key]);
  return {bytes,sha256:hash.digest('hex')};
 }finally{await file.close();}
}
export async function inventory(root:string,budget:Budget){
 const files=new Map<string,Leaf>();const directories=new Set<string>();const queue=[{relative:'',depth:0}];let visited=0;
 while(queue.length){
  const current=queue.pop()!;assert(current.depth<=8&&++visited<=256&&performance.now()<budget.deadline);
  const path=join(root,current.relative);const info=await lstat(path);assert(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid!());
  directories.add(current.relative);const directory=await opendir(path,{bufferSize:16});
  for await(const entry of directory){
   assert(++budget.entries<=1024&&performance.now()<budget.deadline);const relative=current.relative?current.relative+'/'+entry.name:entry.name;
   assert(!entry.isSymbolicLink());
   if(entry.isDirectory()){assert(queue.length<256);queue.push({relative,depth:current.depth+1});}
   else{assert(entry.isFile());files.set(relative,await leaf(join(root,relative),budget));}
  }
 }
 return {files,directories};
}
