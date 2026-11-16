import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {ownedOrigin} from '../public-api.js';
import {readContent,hash} from '../compose/public.js';
import {counter,record} from '../../resources/values.js';
const program=`const h=require('node:http');const counts={ready:0,work:0,unexpected:0,requests:{r0:0,r1:0,r2:0,r3:0}};
h.createServer((q,r)=>{if(q.method==='GET'&&q.url==='/counts'){r.end(JSON.stringify(counts));return;}
if(q.method==='GET'&&q.url==='/ready'){if(++counts.ready>2)process.exit(3);r.end('ok');return;}
const m=/^\\/work\\/(r[0-3])$/.exec(q.url||'');if(q.method!=='GET'||!m){counts.unexpected++;process.exit(4);}
if(++counts.work>8000)process.exit(5);counts.requests[m[1]]++;r.end('ok');}).listen(8080,'0.0.0.0');`;
export async function target(path:string){
 const origin=await ownedOrigin();await writeFile(path,JSON.stringify({services:{'synthetic-target':{entrypoint:['node','-e',program],ports:[`127.0.0.1:${new URL(origin).port}:8080`]}}}),{flag:'wx',mode:0o600});
 return {sourceSha256:hash(program),async counts(){
  const reply=await fetch(origin+'/counts',{redirect:'error',signal:AbortSignal.timeout(2000)});const row=record(JSON.parse((await readContent(reply,1024)).toString()));
  const requests=record(row.requests);const perRequest=['r0','r1','r2','r3'].map(id=>counter(requests[id]));
  const work=counter(row.work);assert.equal(perRequest.reduce((sum,n)=>sum+n,0),work);assert(work<=8000);assert.equal(row.unexpected,0);assert(counter(row.ready)<=2);
  return {ready:counter(row.ready),work,unexpected:0,perRequest};
 }};
}
