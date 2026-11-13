import type { FileHandle } from 'node:fs/promises';
import type { OutputIO } from '../../src/collection/output/ports.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,mkdtemp,writeFile,lstat,chmod,symlink,link,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InventoryTree } from '../../src/task-inventory/tree.js';
import { inventoryPorts } from '../../src/task-inventory/ports.js';
import { nativeFact } from '../../src/task-inventory/checks.js';
import { OutputLifetime } from '../../src/collection/output/lifetime.js';
import { nodePorts } from '../../src/collection/output/ports.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { namespaceCaps } from '../../src/staging-namespace/index.js';
async function fixture(root: string) {
 await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);const task=join(root,'synthetic-task');
 for(const path of [task,...['input','output','secrets'].map(name=>join(task,name))]){await mkdir(path,{recursive:true,mode:0o700});await chmod(path,0o700);}
 const marker=Buffer.from('synthetic native inventory marker');const markerPath=join(root,namespaceCaps.markerName);
 await writeFile(markerPath,marker,{mode:0o400});await writeFile(join(task,'input','readonly.bin'),'input',{mode:0o400});
 await writeFile(join(task,'output','result.txt'),'output',{mode:0o600});
 const stat=await lstat(markerPath,{bigint:true});const native={dev:String(stat.dev),ino:String(stat.ino),uid:String(stat.uid),gid:String(stat.gid),mode:String(stat.mode)};
 return{root,task,installation:{directory:root,native:nativeFact(await lstat(root,{bigint:true})),marker:{...native,bytes:String(stat.size),links:'1' as const,sha256:createHash('sha256').update(marker).digest('hex')}},taskNative:nativeFact(await lstat(task,{bigint:true}))};
}
async function inspect(f:Awaited<ReturnType<typeof fixture>>) {
 const lease=nativeCustody.reserve('cleanup')!;assert(lease);const owner=new OutputLifetime<{ok:true;paths:readonly string[]}>(nodePorts,()=>lease.release());lease.own(owner);lease.bind(f.task);
 const mountIds:string[]=[];const ports={...inventoryPorts,mount:async(handle:FileHandle,io:OutputIO)=>{const id=await inventoryPorts.mount(handle,io);mountIds.push(id);return id;}};
 const tree=new InventoryTree(f.task,f.taskNative,owner,ports,f.installation);
 owner.start(()=>({deadline:performance.now()+10000}),async()=>({ok:true,paths:(await tree.read()).map(row=>row.path)}),()=>tree.namedCheck());
 const result=await owner.public.result;await owner.public.quiesced;await owner.public.close();return {...result,mountIds};
}
assert.equal(process.platform,'linux');const root=await mkdtemp(join(tmpdir(),'beetle-inventory-native-'));const f=await fixture(root);
try {
 const result=await inspect(f);assert(result.ok);assert.deepEqual(result.paths,['','input','input/readonly.bin','output','output/result.txt','secrets']);
 const bad=join(f.task,'output','bad');await symlink('/etc/passwd',bad);assert(!(await inspect(f)).ok);await rm(bad);
 await link(join(f.task,'output','result.txt'),bad);assert(!(await inspect(f)).ok);await rm(bad);
 const invalid=Buffer.concat([Buffer.from(join(f.task,'output')+'/'),Buffer.from([0xff])]);await writeFile(invalid,'x',{mode:0o600});assert(!(await inspect(f)).ok);await rm(invalid);
 if(process.argv[2]) {
  const mounted=await fixture(process.argv[2]);const nested=join(mounted.task,'output','mounted');
  assert.equal((await lstat(nested,{bigint:true})).dev,BigInt(mounted.installation.native.dev));
  const refused=await inspect(mounted);assert(!refused.ok);assert.equal(refused.reason,'custody');assert(new Set(refused.mountIds).size>1);
 }
 console.log(JSON.stringify({passed:true,node:process.version,platform:process.platform,arch:process.arch,actualByteNames:true,actualProcFd:true,actualFdinfo:true,nativeLinkNegatives:true,nestedSameDeviceMount:!!process.argv[2],retained:nativeCustody.status().retained}));
}finally{await rm(root,{recursive:true,force:true});}
