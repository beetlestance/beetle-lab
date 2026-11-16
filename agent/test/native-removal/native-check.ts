import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,mkdtemp,writeFile,lstat,rm,unlink,rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NativeCleanupPlan,CleanupProgress } from '../../src/cleanup-control/index.js';
import { captureNativeCleanupPlan,captureCleanupProgress,nativeCleanupPlanIdentity } from '../../src/cleanup-control/index.js';
import { nativeFact } from '../../src/task-inventory/checks.js';
import { InventoryTree } from '../../src/task-inventory/tree.js';
import { inventoryPorts } from '../../src/task-inventory/ports.js';
import { OutputLifetime } from '../../src/collection/output/lifetime.js';
import { nodePorts } from '../../src/collection/output/ports.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { namespaceCaps } from '../../src/staging-namespace/index.js';
import { startNativeStep } from '../../src/native-removal/operation.js';
assert.equal(process.platform,'linux');
const root=await mkdtemp(join(tmpdir(),'beetle-native-step-'));const task=join(root,'synthetic-task');
for(const path of [task,...['input','output','secrets'].map(name=>join(task,name)),join(task,'output','nested')])await mkdir(path,{mode:0o700});
const content=Buffer.from('synthetic installed marker');const markerPath=join(root,namespaceCaps.markerName);await writeFile(markerPath,content,{mode:0o400});
await writeFile(join(task,'input','readonly.bin'),'input',{mode:0o400});await writeFile(join(task,'output','nested','quoted-"-🪲.txt'),'output',{mode:0o600});
const marker=await lstat(markerPath,{bigint:true});const installation={directory:root,native:nativeFact(await lstat(root,{bigint:true})),marker:{dev:String(marker.dev),ino:String(marker.ino),uid:String(marker.uid),gid:String(marker.gid),mode:String(marker.mode),bytes:String(marker.size),links:'1' as const,sha256:createHash('sha256').update(content).digest('hex')}};
const rootFact=nativeFact(await lstat(task,{bigint:true}));const lease=nativeCustody.reserve('cleanup')!;
const owner=new OutputLifetime<{ok:true;plan:NativeCleanupPlan}>(nodePorts,()=>lease.release());lease.own(owner);lease.bind(task);
const tree=new InventoryTree(task,rootFact,owner,inventoryPorts,installation);
owner.start(()=>({deadline:performance.now()+10000}),async()=>({ok:true,plan:captureNativeCleanupPlan({protocolVersion:1,purpose:'performance',original:{organizationId:'00000000-0000-4000-8000-000000000001',workspaceId:'00000000-0000-4000-8000-000000000002',attemptId:'00000000-0000-4000-8000-000000000003',generation:1,intentDigest:'a'.repeat(64)},namespaceIdentity:'b'.repeat(64),taskNamespaceIdentity:'c'.repeat(64),retirementRequestDigest:'d'.repeat(64),retirementVersion:1,entries:await tree.read()})}),()=>tree.namedCheck());
const prepared=await owner.public.result;await owner.public.quiesced;await owner.public.close();assert(prepared.ok);const plan=prepared.plan;
let progress:CleanupProgress=captureCleanupProgress({protocolVersion:1,planIdentity:nativeCleanupPlanIdentity(plan),entryCount:plan.entries.length,removedCount:0,version:1,state:'prepared'},plan);
let effects=0;let rootReplyLost=false;let firstReplyLost=false;let syncReplyLost=false;
const ports={...inventoryPorts,
 open:async(...args:Parameters<typeof inventoryPorts.open>)=>{const handle=await inventoryPorts.open(...args);const sync=handle.sync.bind(handle);handle.sync=async()=>{await sync();if(firstReplyLost&&!syncReplyLost&&progress.removedCount>0){syncReplyLost=true;throw Error('synthetic committed fsync reply loss');}};return handle;},
 unlink:async(path:string)=>{await unlink(path);effects++;},
 rmdir:async(path:string)=>{await rmdir(path);effects++;if(!firstReplyLost){firstReplyLost=true;throw Error('synthetic committed first rmdir reply loss');}
  if(progress.removedCount===plan.entries.length-1&&!rootReplyLost){rootReplyLost=true;throw Error('synthetic committed root rmdir reply loss');}}};
let failures=0;
try{
 for(let calls=0;progress.state!=='files_absent'&&calls<plan.entries.length+6;calls++){
  const prior=progress;const before=effects;const work=startNativeStep({directory:task,root:rootFact,installation,plan,progress,operation:{deadline:performance.now()+10000},check:()=>undefined,prepareCleaning:async()=>{assert.equal(progress.state,'prepared');progress=captureCleanupProgress({...progress,state:'cleaning',version:2},plan);return progress;}},ports);
  const result=await work.result;await work.quiesced;await work.close();assert(effects-before<=1);
  if(result.ok){progress=result.progress;assert.equal(progress.removedCount,prior.removedCount+1);}else{failures++;assert.equal(progress.removedCount,prior.removedCount);}
 }
 assert.equal(progress.state,'files_absent');assert.equal(effects,plan.entries.length);assert.equal(failures,3);assert(rootReplyLost&&firstReplyLost&&syncReplyLost);
 await assert.rejects(lstat(task),{code:'ENOENT'});assert.equal(nativeCustody.status().retained,0);
 console.log(JSON.stringify({passed:true,node:process.version,platform:process.platform,arch:process.arch,entries:plan.entries.length,effects,failures,firstUnlinkReplyRecovery:true,parentFsyncReplyRecovery:true,finalRootReplyRecovery:true,filesAbsent:true,retained:0}));
}finally{await rm(root,{recursive:true,force:true});}
