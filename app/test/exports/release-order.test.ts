import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createOutputTransfers} from '../../src/application/output-transfer/index.js';
import {reconcileExport} from '../../src/application/export-runtime/step.js';
import type {ExportRuntimeOptions} from '../../src/application/export-runtime/index.js';
import {storageFixture,seed,scope} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {nativeFixture} from '../output-transfer/native-fixture.js';
import {options,createCommand} from './fixture.js';
import {sourceFixture,hash} from './source-fixture.js';
const f=storageFixture();
it('waits for settled release before adopting a successful export, then publishes its real bytes',async()=>{
 const metadata=await f.open(f.path(),options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);
 const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const claim=await metadata.exportExecutions.claim(key);if(claim.kind==='blocked')throw Error('claim');
 const original=await metadata.exportExecutions.original(key);const bytes=Buffer.from('synthetic standalone script\n');
 const source=sourceFixture(original,claim.control,bytes);const files=await nativeFixture();
 const readSource=vi.fn(async()=>({ok:true as const,value:source.envelope}));
 const output=()=>({absence:async()=>{throw Error('Unexpected absence');},source:readSource,sourceChunk:async(input:{offset:number;length:number;artifactId:string;manifestDigest:string;sourceDigest:string})=>{
  const chunk=bytes.subarray(input.offset,input.offset+input.length);
  return {ok:true as const,value:{version:1 as const,manifestDigest:input.manifestDigest,sourceDigest:input.sourceDigest,artifactId:input.artifactId,
   offset:input.offset,nextOffset:input.offset+chunk.length,eof:input.offset+chunk.length===bytes.length,totalBytes:bytes.length,base64:chunk.toString('base64')}};
 }});
 const transfers=createOutputTransfers({metadata:metadata.exportOutputs,gateway:{output},files:files.store,
  freeSpaceReserveBytes:0,newWriterId:randomUUID,digest:hash});
 const charged={...source.snapshot,admission:{state:'charged' as const}};
 const gateway:ExportRuntimeOptions['gateway']={output,exportAttempt:()=>({
  offerExport:async()=>({ok:true,value:charged}),snapshot:async()=>({ok:true,value:source.snapshot}),
  cancelExportOriginal:async()=>{throw Error('Unexpected cancellation');},events:async()=>{throw Error('Unexpected events');},ack:async()=>{throw Error('Unexpected ACK');},
 })};
 const runtime:ExportRuntimeOptions={executions:metadata.exportExecutions,outputs:metadata.exportOutputs,gateway,transfers,onFailure:async()=>{throw Error('Unexpected failure');}};
 try{
  await reconcileExport(runtime,key,new AbortController().signal);
  expect(readSource).not.toHaveBeenCalled();
  expect(await metadata.exports.get(key)).toMatchObject({state:'publishing',artifact:null});
  expect((await metadata.exportOutputs.load(source.binding)).kind).toBe('pending');
  await expect(metadata.exportOutputs.adopt({binding:source.binding,envelope:source.envelope})).rejects.toMatchObject({code:'conflict'});
  await reconcileExport(runtime,key,new AbortController().signal);
  expect(readSource).toHaveBeenCalledTimes(1);
  expect(await metadata.exports.get(key)).toMatchObject({state:'ready',artifact:{bytes:bytes.length,sha256:hash(bytes)}});
 }finally{await transfers.close();await files.dispose();}
});
