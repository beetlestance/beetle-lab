import { expect,it } from 'vitest';
import { retirementRoot } from '../../src/staging/index.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { fixture } from './fixtures.js';
const f=fixture();
it('keeps exclusion through an actual committed receipt reply loss and reopens the immutable worker receipt',async()=>{
 const e=await f.ready();const worker=Reflect.get(e.owner,'worker') as {postMessage(input:unknown):void};
 const send=worker.postMessage.bind(worker);let target:number|undefined;let observed!:(value:unknown)=>void;
 const committed=new Promise(resolve=>{observed=resolve;});const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;
 worker.postMessage=input=>{if(input&&typeof input==='object'&&Reflect.get(input,'kind')==='noTaskReceiptCommit')target=Reflect.get(input,'id') as number;send(input);};
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  if(reply&&typeof reply==='object'&&Reflect.get(reply,'id')===target&&Reflect.get(reply,'ok')===true){observed(Reflect.get(reply,'value'));return;}
  receive.call(e.owner,reply);
 });
 const work=e.native.finalizeWithPorts(e.token,{deadline:performance.now()+10000},e.ports);const stored=await committed;
 expect(e.closed.length).toBe(e.opened.length);expect(nativeCustody.status().cleanup).toBe(1);
 const fence=cleanupAccess(e.owner.retirements).reserve(e.request);let drained=false;
 const pending=fence.drain().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);
 await e.owner.abort();expect(await work.result).toMatchObject({ok:false});await work.quiesced;await pending;fence.release();
 expect(nativeCustody.status().cleanup).toBe(0);const next=await f.open(e.journalPath);const root=retirementRoot(e.options.root);
 const binding={request:e.request,namespaceIdentity:root.namespaceIdentity,taskName:e.name,daemonId:e.configuration.expectedDaemonId,root:root.native,markerDigest:root.marker.sha256};
 expect(await next.noTaskReceipts.read(binding)).toEqual(stored);expect(await next.retirements.preflightRejected(e.request)).toMatchObject({request:e.request});
});
