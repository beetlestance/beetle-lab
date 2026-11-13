import { expect,it } from 'vitest';
import { fixture } from '../retirement-pipeline/fixtures.js';
import { deferred } from '../output-collection/fixture.js';
import { cleanupAccess,drainedSettlementFacts } from '../../src/cleanup-access/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
it('shares the fence across direct services, inventory persistence and the composed pipeline before foreign calls',async()=>{
 const e=await f.pipeline();const work=e.inventory.prepareWithPorts(e.token,operation(),e.ports.inventory);
 const observed=await work.result;await work.quiesced;await work.close();if(!observed.ok)throw Error('Missing real inventory observation');
 await e.inventory.persist(observed.observation,operation());
 const cleaned=e.pipeline.tickWithPorts(e.request,operation(),e.ports);expect((await cleaned.result).state).toBe('cleaned');await cleaned.settled;await turn();
 const gate=cleanupAccess(e.owner.retirements);expect(gate.status().leases).toBe(0);
 const fence=gate.reserve(e.request);const proof=await fence.drain();
 const before={opened:e.opened.length,effects:e.effects.length,docker:e.docker.calls.length};
 expect(()=>e.coordinator.retire(e.request)).toThrow('fenced');
 await expect(e.runtime.retire(e.producer,operation())).rejects.toMatchObject({reason:'conflict'});
 expect(await e.inventory.prepareWithPorts(e.token,operation(),e.ports.inventory).result).toEqual({ok:false,reason:'busy'});
 await expect(e.inventory.persist(observed.observation,operation())).rejects.toThrow('fenced');
 await expect(e.removal.stepWithPorts(e.token,operation(),e.ports.removal)).rejects.toThrow('fenced');
 await expect(e.receipt.finalizeWithPorts(e.token,operation(),e.ports.removal)).rejects.toThrow('fenced');
 await expect(e.pipeline.tickWithPorts(e.request,operation(),e.ports).result).rejects.toBeTruthy();
 expect({opened:e.opened.length,effects:e.effects.length,docker:e.docker.calls.length}).toEqual(before);
 expect(drainedSettlementFacts(proof,e.owner.retirements,e.request)).toEqual(e.request);fence.release();
});
it('waits for an actual late native open/close and refuses new stages while the original drains',async()=>{
 const e=await f.pipeline();const issued=deferred<void>();const release=deferred<void>();
 const ports={...e.ports,inventory:{...e.ports.inventory,open:async(...args:Parameters<typeof e.ports.inventory.open>)=>{
  issued.resolve();await release.promise;return e.ports.inventory.open(...args);
 }}};
 const work=e.pipeline.tickWithPorts(e.request,operation(),ports);void work.result.catch(()=>{});await issued.promise;
 const gate=cleanupAccess(e.owner.retirements);const fence=gate.reserve(e.request);let done=false;
 const pending=fence.drain().then(value=>{done=true;return value;});await turn();expect(done).toBe(false);
 release.resolve();await expect(work.result).rejects.toBeTruthy();await expect(work.settled).rejects.toBeTruthy();
 const proof=await pending;expect(e.closed.length).toBe(e.opened.length);expect(e.effects).toHaveLength(0);
 expect(drainedSettlementFacts(proof,e.owner.retirements,e.request)).toEqual(e.request);fence.release();
});
it('joins inventory quiescence and lease removal when shutdown starts during a held open',async()=>{
 const e=await f.pipeline();const issued=deferred<void>();const release=deferred<void>();
 const ports={...e.ports.inventory,open:async(...args:Parameters<typeof e.ports.inventory.open>)=>{
  issued.resolve();await release.promise;return e.ports.inventory.open(...args);
 }};
 const work=e.inventory.prepareWithPorts(e.token,operation(),ports);await issued.promise;
 let closed=false;const closing=e.inventory.close().then(()=>{closed=true;});
 await turn();expect(closed).toBe(false);expect(cleanupAccess(e.owner.retirements).status().leases).toBe(1);
 release.resolve();await closing;await work.quiesced;
 expect(e.inventory.status().retained).toBe(0);expect(cleanupAccess(e.owner.retirements).status().leases).toBe(0);
 expect(e.closed.length).toBe(e.opened.length);
});
it('does not mint a drain observation after a rejected actual native close',async()=>{
 const e=await f.pipeline();const ports={...e.ports,inventory:{...e.ports.inventory,open:async(...args:Parameters<typeof e.ports.inventory.open>)=>{
  const handle=await e.ports.inventory.open(...args);const close=handle.close.bind(handle);
  handle.close=async()=>{await close();throw Error('synthetic close rejection');};return handle;
 }}};
 const work=e.pipeline.tickWithPorts(e.request,operation(),ports);await expect(work.result).rejects.toBeTruthy();await expect(work.settled).rejects.toBeTruthy();
 const gate=cleanupAccess(e.owner.retirements);const fence=gate.reserve(e.request);let done=false;
 void fence.drain().then(()=>{done=true;});await turn();expect(done).toBe(false);
 expect(gate.status().leases).toBeGreaterThan(0);expect(()=>fence.release()).toThrow('custody');
});
