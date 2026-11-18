import {expect,it} from 'vitest';
import type {LiveMetricArchivePrefix} from '@beetle/contracts/api';
import {fixture,frame,image} from './fixtures.js';
function prefix():LiveMetricArchivePrefix{return {scope:frame().scope,windows:10,endTimeMs:5000,
 data:{artifactId:'00000000-0000-4000-8000-000000000005',relativePath:'metric-windows.ndjson',bytes:4096,sha256:'a'.repeat(64)},
 index:{artifactId:'00000000-0000-4000-8000-000000000006',relativePath:'metric-index.ndjson',bytes:2048,sha256:'b'.repeat(64)}};}
function sample(sequence:number,archivePrefix?:LiveMetricArchivePrefix){return frame({publishedSequence:sequence,sourceSequence:sequence,
 startTimeMs:(sequence-1)*1000,endTimeMs:sequence*1000,capturedAtMs:5000,publishedAtMs:5000,...(archivePrefix?{archivePrefix}:{})});}
it('accepts stable archive identities with strictly growing completed prefixes',async()=>{
 const f=fixture();f.clock(5000);f.set({ok:true,status:200,image:image(sample(1,prefix()))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 const next=prefix();next.windows++;next.data.bytes++;next.index.bytes++;next.endTimeMs=6000;
 f.clock(6000);f.set({ok:true,status:200,image:image({...sample(2,next),capturedAtMs:6000,publishedAtMs:6000})});
 expect((await f.reader.read(f.operation())).ok).toBe(true);await f.reader.close();
});
it.each(['id','count','extent','hash','growth'] as const)('rejects %s changes against the last prefix even after an omitted frame',async kind=>{
 const f=fixture();f.clock(5000);f.set({ok:true,status:200,image:image(sample(1,prefix()))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 f.set({ok:true,status:200,image:image(sample(2))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 const next=prefix();if(kind==='id')next.data.artifactId='00000000-0000-4000-8000-000000000007';
 if(kind==='count')next.windows--;if(kind==='extent')next.data.bytes--;if(kind==='hash')next.index.sha256='c'.repeat(64);
 if(kind==='growth'){next.windows++;next.endTimeMs++;}
 f.set({ok:true,status:200,image:image({...sample(3,next),publishedAtMs:6000})});f.clock(6000);
 expect(await f.reader.read(f.operation())).toEqual({ok:false,reason:'ordering'});await f.reader.close();
});
it('accepts an unchanged completed prefix in a later normal metric revision',async()=>{
 const f=fixture();f.clock(5000);for(const sequence of [1,2]){
 f.set({ok:true,status:200,image:image(sample(sequence,prefix()))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 }await f.reader.close();
});
it('does not lend retained prefix ordering state to callers that receive a frame',async()=>{
 const f=fixture();f.clock(5000);f.set({ok:true,status:200,image:image(sample(1,prefix()))});const first=await f.reader.read(f.operation());
 expect(first.ok).toBe(true);if(!first.ok||!first.frame.archivePrefix)throw Error('Missing test prefix');
 first.frame.archivePrefix.data.bytes=1;first.frame.archivePrefix.index.sha256='c'.repeat(64);first.frame.archivePrefix.scope.generation=2;
 f.set({ok:true,status:200,image:image(sample(2))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 f.set({ok:true,status:200,image:image(sample(3,prefix()))});expect((await f.reader.read(f.operation())).ok).toBe(true);await f.reader.close();
});

function withTarget(){const value=prefix();value.target={scope:value.scope,samples:2,intervalMs:1000,
 data:{artifactId:'00000000-0000-4000-8000-000000000007',relativePath:'target-samples.ndjson',bytes:2048,sha256:'c'.repeat(64)}};return value;}
it('requires independent approval for target-prefix sampling even with no carried target samples',async()=>{
 for(const interval of [null,2000,1000]){
  const f=fixture(interval);f.clock(5000);f.set({ok:true,status:200,image:image(sample(1,withTarget()))});
  const result=await f.reader.read(f.operation());
  if(interval===1000)expect(result.ok).toBe(true);else expect(result).toEqual({ok:false,reason:'target'});
  await f.reader.close();
 }
});
it.each(['id','count','extent','hash','growth'] as const)('retains target prefix ordering after omitted enrichment and rejects %s',async kind=>{
 const f=fixture(1000);f.clock(5000);f.set({ok:true,status:200,image:image(sample(1,withTarget()))});
 const first=await f.reader.read(f.operation());expect(first.ok).toBe(true);
 if(!first.ok)throw Error('Missing initial frame');
 first.frame.archivePrefix!.target!.samples=1;first.frame.archivePrefix!.target!.data.sha256='d'.repeat(64);
 f.set({ok:true,status:200,image:image(sample(2,prefix()))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 const next=withTarget();const target=next.target!;
 if(kind==='id')target.data.artifactId='00000000-0000-4000-8000-000000000008';
 if(kind==='count')target.samples--;if(kind==='extent')target.data.bytes--;if(kind==='hash')target.data.sha256='d'.repeat(64);
 if(kind==='growth')target.samples++;
 f.set({ok:true,status:200,image:image(sample(3,next))});
 expect(await f.reader.read(f.operation())).toEqual({ok:false,reason:'ordering'});await f.reader.close();
});
it('accepts growing target evidence after a frame omits the whole archive prefix',async()=>{
 const f=fixture(1000);f.clock(5000);f.set({ok:true,status:200,image:image(sample(1,withTarget()))});
 expect((await f.reader.read(f.operation())).ok).toBe(true);
 f.set({ok:true,status:200,image:image(sample(2))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 const next=withTarget();next.target!.samples++;next.target!.data.bytes++;next.target!.data.sha256='e'.repeat(64);
 f.set({ok:true,status:200,image:image(sample(3,next))});expect((await f.reader.read(f.operation())).ok).toBe(true);
 await f.reader.close();
});
