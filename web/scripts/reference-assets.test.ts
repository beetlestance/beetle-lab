import {expect,it} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createConfigSchema} from '@beetle/contracts/engine-config';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'vite';
import {referenceAssets,referenceResources} from './reference-assets.js';
import {referenceDownloads} from '../src/app/routes.js';
it('serves exact public contracts/skill over HTTP with no runtime environment leakage or mutation method',async()=>{
 const root=await mkdtemp(join(tmpdir(),'beetle-reference-assets-'));const canary='SYNTHETIC_REFERENCE_PRIVATE_CANARY';
 const previous=process.env.BEETLE_REFERENCE_PRIVATE_CANARY;process.env.BEETLE_REFERENCE_PRIVATE_CANARY=canary;
 const server=await createServer({configFile:false,root,cacheDir:join(root,'cache'),plugins:[referenceAssets()],server:{host:'127.0.0.1',port:0,strictPort:true,watch:null}});
 try{
  await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('Missing task HTTP address');
  const origin=`http://127.0.0.1:${address.port}`;const resources=await referenceResources();const received=new Map<string,string>();
  for(const [path,expected] of resources){
   const response=await fetch(origin+path,{signal:AbortSignal.timeout(3000)});expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe(expected.type);
   const text=await response.text();received.set(path,text);expect(text).toBe(expected.body);expect(text).not.toContain(canary);expect(text.length).toBeLessThanOrEqual(2097152);
   const head=await fetch(origin+path,{method:'HEAD',signal:AbortSignal.timeout(3000)});expect(head.status).toBe(200);expect(await head.text()).toBe('');
   expect(Number(head.headers.get('content-length'))).toBe(Buffer.byteLength(text));
  }
  const document=JSON.parse(received.get(referenceDownloads.catalogue)!) as {operations:unknown[];binaryOperations:{params:string;response:string}[];schemas:{$id:string}[];messages:Record<string,{$ref:string}>};
  const ids=new Set(document.schemas.map(row=>row.$id));expect(ids.size).toBe(document.schemas.length);
  for(const value of Object.values(document.messages))expect(ids.has(value.$ref.split('#',1)[0]!)).toBe(true);
  for(const operation of document.binaryOperations){expect(Object.hasOwn(document.messages,operation.params)).toBe(true);if(operation.response!=='binary')expect(Object.hasOwn(document.messages,operation.response)).toBe(true);}
  const engine=JSON.parse(received.get(referenceDownloads.k6)!) as {schemaId:string;schemas:unknown[]};
  const compiled=createConfigSchema({...engine,digest:value=>createHash('sha256').update(value).digest('hex')});
  const valid=JSON.parse(await readFile(new URL('../../contracts/fixtures/api/valid/suite-revision.json',import.meta.url),'utf8')) as {config:unknown};
  expect(compiled.validate(valid.config)).toBe(true);expect(compiled.validate({version:1,target:'not-a-url'})).toBe(false);
  const denied=await fetch(origin+referenceDownloads.skill,{method:'POST',body:'synthetic',signal:AbortSignal.timeout(3000)});expect(denied.status).toBe(405);expect(denied.headers.get('allow')).toBe('GET, HEAD');
 }finally{if(previous===undefined)delete process.env.BEETLE_REFERENCE_PRIVATE_CANARY;else process.env.BEETLE_REFERENCE_PRIVATE_CANARY=previous;await server.close();await rm(root,{recursive:true,force:true});}
},15000);
