import assert from 'node:assert/strict';
import type {Fixture} from '../compose/fixture.js';
const program=`const f=require('node:fs');const fd=f.openSync('/proc/1/environ','r');let n;const b=Buffer.alloc(16385);try{n=f.readSync(fd,b,0,b.length,0);}finally{f.closeSync(fd);}if(n>16384)process.exit(3);const v=b.subarray(0,n).toString().split('\\0').find(v=>v.startsWith('BEETLE_K6_LIVE_METRICS_V2='));console.log(JSON.stringify({present:v!==undefined,value:v===undefined?null:v==='BEETLE_K6_LIVE_METRICS_V2=1'?'1':'other'}));`;
export function environment(f:Fixture,installation:string,id:string,mode:string){
 assert(/^[a-f0-9]{64}$/.test(id));assert(mode==='on'||mode==='off');
 const rows=f.docker.json<{Image:string;State:{Running:boolean};Config:{Labels:Record<string,string>}}[]>(['inspect',id]);assert.equal(rows.length,1);
 assert.equal(rows[0]!.Image,f.imageIds.engine);assert.equal(rows[0]!.State.Running,true);
 assert.equal(rows[0]!.Config.Labels['dev.beetle.installation'],installation);assert.equal(rows[0]!.Config.Labels['dev.beetle.generation'],'1');
 const result=f.docker.json<unknown>(['exec','--user','1000:1000',id,'node','-e',program]);
 assert.deepEqual(result,mode==='on'?{present:true,value:'1'}:{present:false,value:null});return {mode,runtimeId:id,processOne:result};
}
