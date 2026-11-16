/** Linux qualification setup only: genuine policy admission, then durable abort before staging. */
import assert from 'node:assert/strict';
import { readFile,lstat } from 'node:fs/promises';
import { dirname,basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { encodeCanonicalJson,RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { loadAgentConfiguration } from '../../../../agent/src/bootstrap/configuration.js';
import { openJournal } from '../../../../agent/src/journal/index.js';
import type { Journal } from '../../../../agent/src/journal/index.js';
import { verifyInstallation,NamespaceBinding } from '../../../../agent/src/staging/index.js';
import { createOutputGuard } from '../../../../agent/src/guard/index.js';
import type { OutputGuard } from '../../../../agent/src/guard/index.js';
import { createTimeoutGuard } from '../../../../agent/src/timeout/index.js';
import type { TimeoutGuard } from '../../../../agent/src/timeout/index.js';
import { createResourceObserver,createObservationPublisher } from '../../../../agent/src/observation/index.js';
import type { ResourceObserver,ObservationPublisher } from '../../../../agent/src/observation/index.js';
import { addResources } from '../../../../agent/src/admission/index.js';
async function seedInput(){
 assert.equal(process.platform,'linux');const [configPath,offerPath,extra]=process.argv.slice(2);
 assert(configPath&&offerPath&&!extra&&dirname(configPath)===dirname(offerPath)&&basename(offerPath)==='seed-offer.json');
 const stat=await lstat(offerPath);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.uid===process.getuid!()&&stat.size<=RUNNER_MAXIMUM_OFFER_BYTES&&(stat.mode&0o777)===0o600);
 const input:unknown=JSON.parse(await readFile(offerPath,'utf8'));const loaded=await loadAgentConfiguration({BEETLE_AGENT_CONFIG_FILE:configPath},pathToFileURL('/beetle/agent/worker.js'));
 return {input,loaded};
}
async function waitReady(publisher:ObservationPublisher){
 for(let turn=0;turn<200&&!publisher.status().ready;turn++)await new Promise<void>(resolve=>setTimeout(resolve,50));
 assert(publisher.status().ready,'Native guards/resource observation must be ready');
}
async function closeOwners(closers:(()=>unknown|Promise<unknown>)[]){
 const failures:unknown[]=[];
 for(const close of closers){try{await close();}catch(error){failures.push(error);}}
 return failures;
}
async function main(){
 const {input,loaded}=await seedInput();
 const failures:unknown[]=[];
 let journal:Journal|undefined;let binding:NamespaceBinding|undefined;let output:OutputGuard|undefined;let timeout:TimeoutGuard|undefined;
 let observer:ResourceObserver|undefined;let publisher:ObservationPublisher|undefined;
 try{
  const options=loaded.runtime;const deadline=performance.now()+30000;
  const verified=await verifyInstallation({configuration:options.installation,transport:options.transport,operation:{deadline}});assert(verified.ok,'Seed installation verification');
  journal=await openJournal(options.journal);binding=new NamespaceBinding({root:verified.value,journal:journal.stagingNamespace,journalAuthority:await journal.journalAuthority(),operation:{deadline}});await binding.bind();
  const configuration={...options.configuration,profiles:options.catalog.engines.map(engine=>engine.approved)};
  await journal.admission({kind:'configure',configuration});const overhead=addResources(configuration.controlReserve,configuration.headroom);
  const stop=async()=>{throw Error('No seed actor may need stopping');};
  output=createOutputGuard({root:verified.value,minimumFreeBytes:Math.max(options.minimumFreeBytes,overhead.outputBytes+overhead.stagingBytes),stop});
  timeout=createTimeoutGuard({stop});observer=createResourceObserver({root:verified.value,transport:options.transport,configuration});
  publisher=createObservationPublisher({journal,observer,output,timeout});output.start();timeout.start();publisher.start();
  await waitReady(publisher);
  const checked=options.catalog.preflight(input);const offer:Offer=checked.offer;
  assert.equal(encodeCanonicalJson(offer,RUNNER_MAXIMUM_OFFER_BYTES),encodeCanonicalJson(input,RUNNER_MAXIMUM_OFFER_BYTES),'Seed cannot change captured Offer');
  const key={organizationId:offer.organizationId,workspaceId:offer.workspaceId,attemptId:offer.attemptId,generation:1 as const};
  const queued=await journal.admission({kind:'offer',offer,validation:checked.validation,now:Date.now()});assert('kind'in queued&&queued.kind==='defer'&&queued.reason==='queued');
  const admitted=await journal.admission({kind:'admit',key,sourceOrdinal:1,now:Date.now()});assert('status'in admitted&&admitted.status==='charged','Native policy must actually grant C1');
  await journal.admission({kind:'abortUnstarted',key});assert.equal(await journal.stagingNamespace.readTask(key),null);
  const snapshot=await journal.get(key);assert.deepEqual(snapshot.admission,{state:'released',disposition:'never_started'});assert.equal(snapshot.lastSeq,1);
  console.log(JSON.stringify({state:'seeded',attemptId:offer.attemptId,offerDigest:createHash('sha256').update(encodeCanonicalJson(offer,RUNNER_MAXIMUM_OFFER_BYTES)).digest('hex'),
   admission:snapshot.admission,lastSeq:snapshot.lastSeq,task:'none',nativeObservation:true,cleanupReceipt:false,refund:false}));
 }catch(error){failures.push(error);}
 failures.push(...await closeOwners([()=>publisher?.close(),()=>observer?.close(),()=>timeout?.close(),()=>output?.close(),()=>binding?.close(),()=>journal?.close(),()=>loaded.close()]));
 if(failures.length)throw new AggregateError(failures,'Seed operation or actual owner close failed');
}
main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:'Native seed failed');process.exitCode=1;});
