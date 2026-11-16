import type { FileHandle } from 'node:fs/promises';
import { expect,it } from 'vitest';
import { mkdir,writeFile,chmod,symlink,link,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('observes complete actual prepared task through genuine Journal/producer/runtime authority and all original closes',async()=>{
 const e=await f.inventory();expect(Object.isFrozen(e.root.marker)).toBe(true);await writeFile(join(e.task,'output','synthetic.txt'),'data',{mode:0o600});
 const work=e.inventory.prepareWithPorts(e.token,operation(),e.ports);const result=await work.result;
 expect(result).toMatchObject({ok:true});if(!result.ok)throw Error(result.reason);
 expect(result.plan.entries.map(row=>row.path)).toEqual(['','input','input/input-000.bin','input/manifest.json','input/offer.json','input/staging.json','output','output/synthetic.txt','secrets']);
 expect(result.plan.retirementRequestDigest).toHaveLength(64);await work.quiesced;await work.close();expect(e.closed.length).toBe(e.opened.length);
 expect(nativeCustody.status().cleanup).toBe(0);expect(await e.owner.retirements.read(e.key)).toBeTruthy();
});
it('rejects forged/cross-owner capability before native IO, and production ports refuse unsupported host',async()=>{
 const e=await f.inventory();const forged=e.inventory.prepareWithPorts({} as typeof e.token,operation(),e.ports);
 expect(await forged.result).toMatchObject({ok:false});expect(e.opened).toHaveLength(0);
 const unsupported=e.inventory.prepareWithPorts(e.token,operation(),{...e.ports,platform:'darwin'});expect(await unsupported.result).toMatchObject({ok:false});expect(e.opened).toHaveLength(0);
});
it.each(['symlink','hardlink','mode','foreign-root','nested-mount'] as const)('refuses %s without unlink or changed released reservation/retirement',async mode=>{
 const e=await f.inventory();const output=join(e.task,'output');const path=join(output,'unexpected');const before={reservation:await e.owner.admission({kind:'reservation',key:e.key}),intent:await e.owner.retirements.read(e.key)};
 if(mode==='symlink')await symlink('missing',path);
 if(mode==='hardlink'){await writeFile(path,'test',{mode:0o600});await link(path,join(output,'alias'));}
 if(mode==='mode'){await writeFile(path,'test');await chmod(path,0o644);}
 if(mode==='foreign-root'){await rename(output,`${output}-old`);await mkdir(output,{mode:0o700});}
 const ports=mode==='nested-mount'?{...e.ports,mount:async(handle:FileHandle)=>e.handles.get(handle)===output?'other-mount':'synthetic-mount'}:e.ports;
 const work=e.inventory.prepareWithPorts(e.token,operation(),ports);expect(await work.result).toMatchObject({ok:false});await work.quiesced;
 if(mode==='foreign-root'){await rm(output,{recursive:true});await rename(`${output}-old`,output);}
 expect(e.closed.length).toBe(e.opened.length);expect(await e.owner.retirements.read(e.key)).toBeTruthy();expect({reservation:await e.owner.admission({kind:'reservation',key:e.key}),intent:await e.owner.retirements.read(e.key)}).toEqual(before);
});

it('refuses capacity before capturing operation or invoking native factories',async()=>{
 const e=await f.inventory();const leases=[];for(let n=0;n<2;n++){const lease=nativeCustody.reserve('cleanup')!;lease.own({});lease.bind(`/synthetic/held-${n}`);leases.push(lease);}
 let captures=0;const forbidden=new Proxy(operation(),{getOwnPropertyDescriptor(){captures++;throw Error('must refuse before capture');}});
 try{expect(await e.inventory.prepareWithPorts(e.token,forbidden,e.ports).result).toEqual({ok:false,reason:'busy'});expect(captures).toBe(0);expect(e.opened).toHaveLength(0);}
 finally{for(const lease of leases)lease.release();}
});
