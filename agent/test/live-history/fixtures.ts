import {mkdtemp,realpath,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readLiveHistory} from '../../src/collection/live-history/index.js';
import type {PrefixReadOptions} from '../../src/collection/live-history/index.js';
import {nodePorts} from '../../src/collection/output/index.js';
import {frame} from '../live-metrics/fixtures.js';
import {liveMetricSubsetText} from '@beetle/contracts/api';
import type {LiveMetricArchivePrefix} from '@beetle/contracts/api';
export const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export async function historyFixture(cleanups:(()=>Promise<unknown>)[],count=3,seriesCount=1){
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
 return {directory,prefix,options,start:(ports=nodePorts,overrides:Partial<PrefixReadOptions>={})=>{const operation=readLiveHistory({...options,...overrides},ports);cleanups.push(async()=>{await operation.quiesced;await operation.close();});return operation;}};
}
