import {mkdtemp,realpath,writeFile,readFile,rm,appendFile,rename,symlink,truncate,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
import {readLiveHistory} from '../../src/collection/live-history/index.js';
import {nodePorts} from '../../src/collection/output/index.js';
import {nativeCustody} from '../../src/collection/native-custody/index.js';
import {frame} from '../live-metrics/fixtures.js';
import {liveMetricSubsetText,encodeLiveMetricHistory} from '@beetle/contracts/api';
import {jsonNodeCount} from '@beetle/contracts';
import type {LiveMetricArchivePrefix} from '@beetle/contracts/api';
const cleanups:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
async function fixture(count=3,seriesCount=1){
 const directory=await mkdtemp(join(await realpath(tmpdir()),'beetle-live-prefix-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));
 const base=frame();base.subset.selected=Array.from({length:seriesCount},(_,ordinal)=>({...base.subset.selected[0]!,ordinal,tags:{phase:'execute',request:'r'+ordinal}}));base.subsetDigest=sha(liveMetricSubsetText(base.subset));const dataId='00000000-0000-4000-8000-000000000005';
 const header=(format:string)=>JSON.stringify({format,version:1,scope:base.scope,dataArtifactId:dataId})+'\n';
 let data=header('beetle-k6-metric-windows');let index=header('beetle-k6-metric-index');
 for(let sequence=1;sequence<=count;sequence++){
  const window={startTimeMs:(sequence-1)*1000,endTimeMs:sequence*1000,series:base.subset.selected.map(row=>({metric:row.metric,kind:row.kind,scope:row.scope,tags:row.tags,total:{kind:'counter',sum:sequence}}))};
  const row=JSON.stringify({kind:'window',sequence,window})+'\n';
  index+=JSON.stringify({sequence,startTimeMs:window.startTimeMs,endTimeMs:window.endTimeMs,offset:Buffer.byteLength(data),length:Buffer.byteLength(row)})+'\n';data+=row;
 }
 await writeFile(join(directory,'metric-windows.ndjson'),data,{mode:0o600});await writeFile(join(directory,'metric-index.ndjson'),index,{mode:0o600});
 const prefix:LiveMetricArchivePrefix={scope:base.scope,windows:count,endTimeMs:count*1000,data:{artifactId:dataId,relativePath:'metric-windows.ndjson',bytes:Buffer.byteLength(data),sha256:sha(data)},index:{artifactId:'00000000-0000-4000-8000-000000000006',relativePath:'metric-index.ndjson',bytes:Buffer.byteLength(index),sha256:sha(index)}};
 const options={directory,uid:process.getuid!(),scope:base.scope,frame:frame({...base,archivePrefix:prefix,capturedAtMs:count*1000,publishedAtMs:count*1000}),deadline:performance.now()+30000};
 return {directory,prefix,options,start:(ports=nodePorts)=>{const operation=readLiveHistory(options,ports);cleanups.push(async()=>{await operation.quiesced;await operation.close();});return operation;}};
}
it('verifies both captured prefix hashes and returns actual selected metric windows',async()=>{
 const f=await fixture();const result=await f.start().result;expect(result.ok).toBe(true);if(!result.ok)throw Error(result.reason);
 expect(result.value.sampled).toBe(false);expect(result.value.samples.map(x=>x.sequence)).toEqual([1,2,3]);
 expect(result.value.samples[1]?.series[0]?.total).toEqual({kind:'counter',sum:2});
});
it('permits later appends and unrelated file creation without reading beyond the captured prefix',async()=>{
 const f=await fixture();await appendFile(join(f.directory,'metric-windows.ndjson'),'later incomplete data');await appendFile(join(f.directory,'metric-index.ndjson'),'later index');await writeFile(join(f.directory,'other-output'),'later');
 expect(await f.start().result).toMatchObject({ok:true,value:{samples:[{sequence:1},{sequence:2},{sequence:3}]}});
});
it('retains at most900 actual source windows including first and last, explicitly sampled',async()=>{
 const f=await fixture(1800);const result=await f.start().result;expect(result.ok).toBe(true);if(!result.ok)throw Error(result.reason);
 expect(result.value.sampled).toBe(true);expect(result.value.samples).toHaveLength(900);expect(result.value.samples[0]?.sequence).toBe(1);expect(result.value.samples.at(-1)?.sequence).toBe(1800);
 expect(new Set(result.value.samples.map(x=>x.sequence)).size).toBe(900);
});
it.each(['data','index'] as const)('rejects changed %s prefix bytes before returning history',async lane=>{
 const f=await fixture();const path=join(f.directory,f.prefix[lane].relativePath);const value=await readFile(path);value[value.length-3]=32;await writeFile(path,value);
 expect(await f.start().result).toMatchObject({ok:false});
});
it('rejects an index with a verified hash but a wrong data offset',async()=>{
 const f=await fixture();const path=join(f.directory,'metric-index.ndjson');const lines=(await readFile(path,'utf8')).trimEnd().split('\n');
 const row=JSON.parse(lines[1]!);row.offset++;lines[1]=JSON.stringify(row);const bytes=lines.join('\n')+'\n';await writeFile(path,bytes);f.prefix.index.bytes=Buffer.byteLength(bytes);f.prefix.index.sha256=sha(bytes);
 expect(await f.start().result).toEqual({ok:false,reason:'integrity'});
});
it.each(['symlink','truncated'] as const)('rejects %s prefix sources',async kind=>{
 const f=await fixture();const path=join(f.directory,'metric-windows.ndjson');
 if(kind==='symlink'){await rename(path,path+'.moved');await symlink(path+'.moved',path);}else await truncate(path,10);
 expect(await f.start().result).toMatchObject({ok:false,reason:'custody'});
});
it('retains ignored-abort IO and overlapping cleanup exclusion until the original read settles',async()=>{
 const f=await fixture();let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(r=>{release=r});const started=new Promise<void>(r=>{entered=r});
 const ports={...nodePorts,open:vi.fn<typeof nodePorts.open>(async(...args)=>{const handle=await nodePorts.open(...args);
  if(args[0]===join(f.directory,'metric-windows.ndjson')){const read=handle.read.bind(handle);vi.spyOn(handle,'read').mockImplementation(async(...parameters)=>{entered();await gate;return read(...parameters);});}return handle;})};
 const operation=f.start(ports);await started;const closed=operation.close();expect(await operation.result).toEqual({ok:false,reason:'closed'});
 let quiet=false;void operation.quiesced.then(()=>{quiet=true});await Promise.resolve();expect(quiet).toBe(false);
 const cleanup=nativeCustody.reserve('cleanup')!;cleanup.own({});try{expect(()=>cleanup.bind(f.directory)).toThrow(expect.objectContaining({reason:'busy'}));}finally{cleanup.release();release();}
 await closed;await operation.quiesced;expect(quiet).toBe(true);
});
it('rejects another independently selected scope before any filesystem open',async()=>{
 const f=await fixture();f.options.scope={...f.options.scope,generation:2};const open=vi.fn(nodePorts.open);
 expect(await f.start({...nodePorts,open}).result).toEqual({ok:false,reason:'invalid_options'});expect(open).not.toHaveBeenCalled();
});
it.each([1,17])('accepts bounded native short reads of %i bytes without per-fragment ownership',async size=>{
 const f=await fixture(size===1?1:20);let calls=0;
 const ports={...nodePorts,open:vi.fn<typeof nodePorts.open>(async(...args)=>{
  const handle=await nodePorts.open(...args);if(args[0]===join(f.directory,'metric-windows.ndjson')){
   const read=handle.read.bind(handle);vi.spyOn(handle,'read').mockImplementation(async(...parameters)=>{
    calls++;if(parameters[0])parameters[0].length=Math.min(parameters[0].length??65536,size);return read(...parameters);
   });}return handle;
 })};
 expect(await f.start(ports).result).toMatchObject({ok:true});expect(calls).toBeGreaterThan(1);
 expect(calls).toBeLessThanOrEqual(4*Math.ceil(f.prefix.data.bytes/65536)+1024);
});
it('rejects excessive one-byte native fragmentation at the fixed call bound',async()=>{
 const f=await fixture(20);let calls=0;
 const ports={...nodePorts,open:vi.fn<typeof nodePorts.open>(async(...args)=>{
  const handle=await nodePorts.open(...args);if(args[0]===join(f.directory,'metric-windows.ndjson')){
   const read=handle.read.bind(handle);vi.spyOn(handle,'read').mockImplementation(async(...parameters)=>{
    calls++;if(parameters[0])parameters[0].length=1;return read(...parameters);
   });}return handle;
 })};
 expect(await f.start(ports).result).toEqual({ok:false,reason:'integrity'});
 expect(calls).toBe(4*Math.ceil(f.prefix.data.bytes/65536)+1024);
});
it.each(['root','file'] as const)('rejects %s replacement while reading retained original descriptors',async kind=>{
 const f=await fixture();let changed=false;
 const ports={...nodePorts,open:vi.fn<typeof nodePorts.open>(async(...args)=>{
  const handle=await nodePorts.open(...args);if(args[0]===join(f.directory,'metric-windows.ndjson')){
   const read=handle.read.bind(handle);vi.spyOn(handle,'read').mockImplementation(async(...parameters)=>{
    const value=await read(...parameters);if(!changed){changed=true;
     if(kind==='root'){const moved=f.directory+'.moved';await rename(f.directory,moved);cleanups.push(()=>rm(moved,{recursive:true,force:true}));await mkdir(f.directory,{mode:0o700});}
     else{const path=join(f.directory,'metric-windows.ndjson');const bytes=await readFile(path);await rename(path,path+'.moved');await writeFile(path,bytes,{mode:0o600});}
    }return value;
   });}return handle;
 })};
 expect(await f.start(ports).result).toEqual({ok:false,reason:'custody'});
});
it('does not return successful data or release native admission before an original close settles',async()=>{
 const f=await fixture();let release!:()=>void;let entered!:()=>void;const gate=new Promise<void>(r=>{release=r});const closing=new Promise<void>(r=>{entered=r});
 const ports={...nodePorts,open:vi.fn<typeof nodePorts.open>(async(...args)=>{
  const handle=await nodePorts.open(...args);if(args[0]===join(f.directory,'metric-windows.ndjson')){
   const close=handle.close.bind(handle);vi.spyOn(handle,'close').mockImplementation(async()=>{entered();await gate;await close();});
  }return handle;
 })};
 const operation=f.start(ports);let returned=false;void operation.result.then(()=>{returned=true});
 try{await closing;expect(returned).toBe(false);expect(nativeCustody.status().range).toBe(1);}finally{release();}
 expect(await operation.result).toMatchObject({ok:true});await operation.quiesced;expect(nativeCustody.status().range).toBe(0);
});
it('does not expose otherwise valid projected windows when their captured hash differs',async()=>{
 const f=await fixture();const path=join(f.directory,'metric-windows.ndjson');const bytes=(await readFile(path,'utf8')).replace('"sum":2','"sum":9');await writeFile(path,bytes);
 expect(await f.start().result).toEqual({ok:false,reason:'integrity'});
});

it('compacts actual windows to the shared structural budget while preserving endpoints and valid wire encoding',async()=>{
 const f=await fixture(300,20);const result=await f.start().result;expect(result.ok).toBe(true);if(!result.ok)throw Error(result.reason);
 expect(result.value.sampled).toBe(true);expect(result.value.samples.length).toBeLessThan(300);expect(result.value.samples[0]?.sequence).toBe(1);expect(result.value.samples.at(-1)?.sequence).toBe(300);
 expect(jsonNodeCount(result.value)).toBeLessThanOrEqual(65536);expect(()=>encodeLiveMetricHistory(result.value,sha)).not.toThrow();
});
