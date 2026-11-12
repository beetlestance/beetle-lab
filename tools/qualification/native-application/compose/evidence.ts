import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import type {Fixture} from './fixture.js';
import {request} from '../../../../agent/test/container/docker.js';
import {validate} from '@beetle/contracts';
const stateProgram="const f=require('node:fs'),c=require('node:crypto');const s=f.readFileSync('/proc/1/status','utf8');const token=f.readFileSync(process.argv[1]);if(token.length>128)process.exit(3);console.log(JSON.stringify({uid:/^Uid:\\s+(.+)$/m.exec(s)[1].trim().split(/\\s+/).map(Number),gid:/^Gid:\\s+(.+)$/m.exec(s)[1].trim().split(/\\s+/).map(Number),caps:/^CapEff:\\s+([a-f0-9]+)$/m.exec(s)[1],credential:c.createHash('sha256').update(token).digest('hex')}));";
export function agentState(f:Fixture){
 const credentialFile=join(f.home,'data/config/agent-token');const state=serviceIdentity(f,f.agent);
 const reply=request(f.docker,{agent:f.agent,credentialFile,path:'/runner/v1/capabilities'});assert.equal(reply.status,200);const checked=validate('Capabilities',JSON.parse(reply.body));assert(checked.ok);
 return {state,journalAuthority:checked.value.journalAuthority,installationId:checked.value.observation.installationId,engines:checked.value.engines};
}
export function targetCounts(f:Fixture){
 const id=f.compose('ps','-q','synthetic-target');assert(/^[a-f0-9]{64}$/.test(id));
 const program="fetch('http://127.0.0.1:8080/counts',{signal:AbortSignal.timeout(2000)}).then(r=>r.text()).then(s=>{if(s.length>256)process.exit(3);console.log(s)}).catch(()=>process.exit(2));";
 const counts=f.docker.json(['exec',id,'node','-e',program]);assert.deepEqual(counts,{ready:1,work:1,unexpected:0});return counts;
}
export function engines(f:Fixture,installation:string){
 const ids=f.docker.ownedIds(installation);assert.equal(ids.length,2);
 const rows=f.docker.json<{Id:string;Image:string;State:{Running:boolean;ExitCode:number;OOMKilled:boolean};HostConfig:{NetworkMode:string;Memory:number;NanoCpus:number;PidsLimit:number}}[]>(['inspect',...ids]);
 const offline=f.docker.json<{Id:string}[]>(['image','inspect',f.images.offline!])[0]!.Id;
 for(const row of rows){assert.equal(row.State.Running,false);assert.equal(row.State.ExitCode,0);assert.equal(row.State.OOMKilled,false);assert.equal(row.HostConfig.Memory,536870912);assert.equal(row.HostConfig.NanoCpus,1000000000);assert.equal(row.HostConfig.PidsLimit,128);}
 assert.equal(rows.filter(row=>row.Image===offline).length,1);assert.equal(rows.find(row=>row.Image===offline)!.HostConfig.NetworkMode,'none');return rows;
}
export async function cleanup(f:Fixture,installation:string|undefined){
 const failures:string[]=[];
 for(const id of f.ids()){
  try{await writeFile(join(f.root,id+'-inspect.json'),f.docker.run(['inspect',id]),{mode:0o600});}catch{failures.push('inspect');}
  try{await writeFile(join(f.root,id+'-logs.txt'),f.logs(id),{mode:0o600});}catch{failures.push('logs');}
 }
 f.compose('stop');if(installation){for(const id of f.docker.ownedIds(installation))f.docker.run(['rm','-f',id]);}
 f.compose('down');assert.equal(f.ids().length,0);if(installation)assert.equal(f.docker.ownedIds(installation).length,0);
 assert.equal(f.docker.run(['network','ls','-q','--filter',`label=com.docker.compose.project=${f.project}`]),'');return {verified:true,logFailures:failures};
}

function serviceIdentity(f:Fixture,id:string){
 const credentialFile=join(f.home,'data/config/agent-token');
 const state=f.docker.json<{uid:number[];gid:number[];caps:string;credential:string}>(['exec','--user','1000:1000',id,'node','-e',stateProgram,credentialFile]);
 assert.deepEqual(state.uid,[1000,1000,1000,1000]);assert.deepEqual(state.gid,[1000,1000,1000,1000]);assert(/^0+$/.test(state.caps));
 return state;
}
export function backendState(f:Fixture){const id=f.compose('ps','-q','backend');assert(/^[a-f0-9]{64}$/.test(id));return serviceIdentity(f,id);}
