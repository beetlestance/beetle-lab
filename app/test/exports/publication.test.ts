import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createOutputTransfers} from '../../src/application/output-transfer/index.js';
import {storageFixture,seed,scope} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {nativeFixture} from '../output-transfer/native-fixture.js';
import {options,createCommand} from './fixture.js';
import {sourceFixture,hash} from './source-fixture.js';
const f=storageFixture();
async function setup(status:'succeeded'|'failed'='succeeded'){
 const path=f.path();const config=options();const metadata=await f.open(path,config);await seed(metadata);
 const body=request();body.config.secrets=[];const revision=await append(metadata,await createSuite(metadata),60,body);
 const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const claim=await metadata.exportExecutions.claim(key);if(claim.kind==='blocked')throw Error('claim');
 const original=await metadata.exportExecutions.original(key);const bytes=Buffer.from('synthetic standalone script\n');
 const source=sourceFixture(original,claim.control,bytes,status);
 await metadata.exportExecutions.observe({key,snapshot:source.snapshot,journalAuthority:source.binding.journalAuthority});
 return {metadata,path,config,key,bytes,...source};
}
it('requires real native publication before ready/refund, then preserves verified bytes and source across reopen',async()=>{
 const e=await setup();const files=await nativeFixture();const gateway={output:()=>({
  source:async()=>({ok:true as const,value:e.envelope}),sourceChunk:async(request:{offset:number;length:number;artifactId:string;manifestDigest:string;sourceDigest:string})=>{
   const bytes=e.bytes.subarray(request.offset,request.offset+request.length);
   return {ok:true as const,value:{version:1 as const,manifestDigest:request.manifestDigest,sourceDigest:request.sourceDigest,artifactId:request.artifactId,
    offset:request.offset,nextOffset:request.offset+bytes.length,eof:request.offset+bytes.length===e.bytes.length,totalBytes:e.bytes.length,base64:bytes.toString('base64')}};
  }})};
 const service=createOutputTransfers({metadata:e.metadata.exportOutputs,gateway,files:files.store,freeSpaceReserveBytes:0,newWriterId:randomUUID,digest:hash});
 try{
  await e.metadata.exportOutputs.adopt({binding:e.binding,envelope:e.envelope});
  const final={binding:e.binding,sourceDigest:e.envelope.sourceDigest,manifestDigest:e.envelope.manifest.manifestDigest};
  expect(await e.metadata.exportExecutions.finalize(final)).toMatchObject({state:'publishing',artifact:null});
  const work=service.transfer(e.binding);expect((await work.result).kind).toBe('published');await work.settled;
  expect(await e.metadata.exportExecutions.finalize(final)).toMatchObject({state:'ready',artifact:{bytes:e.bytes.length,sha256:hash(e.bytes)}});
  await service.close();await f.close(e.metadata);await files.reopen();
  const db=new DatabaseSync(e.path);try{
   expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3145728+e.bytes.length);
   expect(db.prepare('SELECT execution_charged FROM export_jobs').get()?.execution_charged).toBe(0);
  }finally{db.close();}
  const metadata=await f.open(e.path,{...e.config,runtime:null});expect((await metadata.exports.get(e.key)).state).toBe('ready');
  expect(await metadata.exportOutputs.readSource(e.binding)).toEqual(e.envelope);
  const state=await metadata.exportOutputs.load(e.binding);if(state.kind!=='adopted')throw Error('source');
  const collected:Buffer[]=[];const read=files.store.read({record:{binding:e.binding,artifact:state.artifacts[0]!},start:0,endExclusive:e.bytes.length,
   sink:{write:async bytes=>{collected.push(Buffer.from(bytes));}}},{deadline:performance.now()+5000,freeSpaceReserveBytes:0});
  await read.result;await read.settled;expect(Buffer.concat(collected)).toEqual(e.bytes);
 }finally{await service.close();await files.dispose();}
});
it('settles known generation failure through its distinct source with no fabricated script or performance Run',async()=>{
 const e=await setup('failed');expect((await e.metadata.exportOutputs.adopt({binding:e.binding,envelope:e.envelope})).kind).toBe('adopted');
 const job=await e.metadata.exportExecutions.finalize({binding:e.binding,sourceDigest:e.envelope.sourceDigest,manifestDigest:e.envelope.manifest.manifestDigest});
 expect(job).toMatchObject({state:'failed',reason:'build_failed',artifact:null});await f.close(e.metadata);
 const db=new DatabaseSync(e.path);try{
  expect(db.prepare('SELECT COUNT(*) n FROM runs').get()?.n).toBe(0);expect(db.prepare('SELECT COUNT(*) n FROM export_artifacts').get()?.n).toBe(0);
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3145728);
 }finally{db.close();}
});
