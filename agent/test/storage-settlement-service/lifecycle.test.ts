import { afterEach,expect,it,vi } from 'vitest';
import { fixture } from '../storage-settlement/fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { StorageSettlement } from '../../src/storage-settlement/index.js';
const f=fixture();const services:StorageSettlement[]=[];
afterEach(async()=>{await Promise.all(services.splice(0).map(service=>service.close()));});
function service(owner:Awaited<ReturnType<typeof f.open>>){const result=new StorageSettlement({journal:owner});services.push(result);return result;}
const operation=()=>({deadline:performance.now()+10000});
it('preflights without purging, then settles and replays through the bounded service',async()=>{
 const e=await f.cleaned();e.fence.release();const s=service(e.owner);
 await e.owner.settlements.preflight(e.request);expect(await e.owner.get(e.key)).toBeDefined();
 expect(await e.owner.settlements.retiredReply(e.request.retirement)).toBeNull();
 const work=s.settle(e.request,operation());const reply=await work.result;await work.settled;
 expect(reply.state).toBe('settled');expect(s.status().retained).toBe(0);
 const replay=s.settle(e.request,operation());expect(await replay.result).toEqual(reply);await replay.settled;
 await expect(e.owner.get(e.key)).rejects.toMatchObject({code:'conflict'});
});
it('rejects ineligible metadata before fencing native cleanup',async()=>{
 const e=await f.pipeline();const s=service(e.owner);
 const work=s.settle({version:1,retirement:e.request,cleanupReplyDigest:'0'.repeat(64)},operation());
 await expect(work.result).rejects.toMatchObject({code:'conflict'});await expect(work.settled).rejects.toBeDefined();
 expect(cleanupAccess(e.owner.retirements).status().fences).toBe(0);expect(s.status().retained).toBe(0);
});
it.each(['abort','stop','deadline'] as const)('withdraws an unissued %s wait while retaining actual native ownership',async kind=>{
 const e=await f.cleaned();e.fence.release();const s=service(e.owner);const gate=cleanupAccess(e.owner.retirements);
 const lease=gate.acquire(e.request.retirement);const abort=new AbortController();
 const work=s.settle(e.request,{signal:abort.signal,deadline:performance.now()+(kind==='deadline'?100:10000)});
 for(let n=0;n<100&&gate.status().fences===0;n++)await new Promise(resolve=>setTimeout(resolve,5));
 expect(gate.status().fences).toBe(1);
 if(kind==='abort')abort.abort();if(kind==='stop')s.stop();
 await expect(work.result).rejects.toBeDefined();await expect(work.settled).rejects.toBeDefined();
 expect(gate.status()).toEqual({originals:1,leases:1,fences:0});expect(s.status().retained).toBe(0);
 expect(await e.owner.get(e.key)).toBeDefined();lease.release();
});
it('reserves two entries before waiting on preflight and retains them until its real reply',async()=>{
 const e=await f.cleaned();e.fence.release();const s=service(e.owner);const held:unknown[]=[];
 const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{
  if(reply&&typeof reply==='object'&&Reflect.get(reply,'value')?.state==='eligible'){held.push(reply);return;}
  receive.call(e.owner,reply);
 });
 const first=s.settle(e.request,operation());const second=s.settle(e.request,operation());
 const third=s.settle(e.request,operation());await expect(third.result).rejects.toMatchObject({reason:'capacity'});
 for(let n=0;n<100&&held.length<2;n++)await new Promise(resolve=>setTimeout(resolve,5));
 expect(held).toHaveLength(2);s.stop();expect(s.status().retained).toBe(2);
 for(const reply of held)receive.call(e.owner,reply);
 await expect(first.result).rejects.toBeDefined();await expect(second.result).rejects.toBeDefined();
 await s.close();expect(s.status().retained).toBe(0);expect(await e.owner.get(e.key)).toBeDefined();
});

it('invalidates a minted drain observation when cancellation arrives before the mutating carrier claim',async()=>{
 const e=await f.cleaned();e.fence.release();const s=service(e.owner);const gate=cleanupAccess(e.owner.retirements);
 const abort=new AbortController();const reserve=gate.reserve.bind(gate);
 const spy=vi.spyOn(gate,'reserve').mockImplementation(input=>{
  const fence=reserve(input);return{...fence,drain:()=>{const proof=fence.drain();abort.abort();return proof;}};
 });
 try{
  const work=s.settle(e.request,{deadline:performance.now()+10000,signal:abort.signal});
  await expect(work.result).rejects.toBeDefined();await expect(work.settled).rejects.toBeDefined();
  expect(await e.owner.get(e.key)).toBeDefined();expect(await e.owner.settlements.retiredReply(e.request.retirement)).toBeNull();
  expect(gate.status()).toEqual({originals:0,leases:0,fences:0});expect(s.status().retained).toBe(0);
 }finally{spy.mockRestore();}
});
