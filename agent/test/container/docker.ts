import {Docker} from '../../../tools/qualification/docker.js';
export {Docker};

export interface Image { Id: string; Os: string; Architecture: string; Config: { Env: string[] } }
export interface Daemon { ID: string; OSType: string; Architecture: string; DefaultRuntime: string; ServerVersion: string }
export interface Inspection {
  Image: string; State: { Running: boolean; ExitCode: number; OOMKilled: boolean };
  HostConfig: { NanoCpus: number; Memory: number; MemorySwap: number; PidsLimit: number; ReadonlyRootfs: boolean };
}
const client = `const fs=require('node:fs');const q=JSON.parse(fs.readFileSync(0,'utf8'));
const token=fs.readFileSync(process.argv[1],'utf8');
fetch('http://127.0.0.1:4312'+q.path,{method:q.method,headers:{authorization:'Bearer '+token,...q.headers},
...(q.body?{body:JSON.stringify(q.body)}:{}),signal:AbortSignal.timeout(3000)}).then(async r=>{
const reader=r.body.getReader();const chunks=[];let bytes=0;
while(true){const p=await reader.read();if(p.done)break;bytes+=p.value.byteLength;
if(bytes>1048576){await reader.cancel();throw Error('reply limit');}chunks.push(Buffer.from(p.value));}
console.log(JSON.stringify({status:r.status,body:Buffer.concat(chunks,bytes).toString('utf8')}));
}).catch(()=>process.exit(2));`;
export function request(docker: Docker, input: {
  agent: string; credentialFile: string; headers?: Record<string, string>; path: string; method?: string; body?: unknown; user?: string;
}): { status: number; body: string } {
  const { path, method = 'GET', headers = {}, body } = input;
  if (input.user !== undefined && (input.user.trim() !== input.user || !/^[1-9][0-9]{0,8}:[1-9][0-9]{0,8}$/.test(input.user))) throw new Error('Invalid qualification request identity');
  return JSON.parse(docker.run(['exec', '-i', ...(input.user ? ['--user', input.user] : []), input.agent, 'node', '-e', client, input.credentialFile],
    JSON.stringify({ path, method, headers, body }))) as { status: number; body: string };
}
