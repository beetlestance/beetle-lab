import {afterEach,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {OutputBinding} from '../../../src/domain/output-owner/index.js';
import type {OutputByteStore,OutputFileRecord} from '../../../src/ports/output-bytes.js';
import {fixture,record,context,finish} from './fixture.js';
import type {Fixture} from './fixture.js';
import {exportBinding} from '../../output-owner/fixture.js';
const owned:Fixture[]=[];afterEach(async()=>{for(const f of owned.splice(0))await f.dispose();});
async function publish(files:OutputByteStore<OutputBinding>,input:OutputFileRecord<OutputBinding>,bytes:Uint8Array){
 const prepared=await finish(files.prepare(input,context()));
 let value:OutputFileRecord<OutputBinding>={...input,artifact:{...input.artifact,identity:prepared.identity}};
 const appended=await finish(files.append({record:value,offset:0,bytes},context()));
 value={...value,artifact:{...value.artifact,offset:appended.offset,identity:appended.identity,phase:'publishing'}};
 const published=await finish(files.publish(value,context()));
 return {...value,artifact:{...value.artifact,phase:'published' as const,identity:published.identity,writer:null}};
}
it('publishes and reopens separate Run/export custody in one native namespace without identity substitution',async()=>{
 const f=await fixture();owned.push(f);const bytes=Buffer.from('synthetic script');const original=record(bytes);
 const owner=exportBinding();const output:OutputFileRecord<OutputBinding>={...original,binding:owner};
 const run=await publish(f.store,original,bytes);const exported=await publish(f.store,output,bytes);
 expect(exported.artifact.identity).not.toBe(run.artifact.identity);
 const a=original.binding.key.attempt;
 const path=join(f.options.publishedRoot,'exports',a.organizationId,a.workspaceId,owner.key.exportId,a.attemptId,output.artifact.token);
 expect(await readFile(path)).toEqual(bytes);expect(await readFile(f.path(original,true))).toEqual(bytes);
 await f.reopen();const received:Buffer[]=[];
 await finish(f.store.read({record:exported,start:0,endExclusive:bytes.length,sink:{write:async part=>{received.push(Buffer.from(part));}}},context()));
 expect(Buffer.concat(received)).toEqual(bytes);
 const wrong={...run,artifact:{...run.artifact,identity:exported.artifact.identity}};
 await expect(finish(f.store.read({record:wrong,start:0,endExclusive:bytes.length,sink:{write:async()=>{}}},context()))).rejects.toMatchObject({code:'integrity'});
});
