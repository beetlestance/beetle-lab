import { expect,it,vi } from 'vitest';
import { deferred,until } from '../output-transfer/fixtures.js';
import { model,original } from './coordinator-fixtures.js';
it('leaves local fencing until known funding and joins the actual carrier before reconciling a committed rejection',async()=>{
 const e=model({rejected:true});const carrier=deferred<void>();
 e.funding.fundRejected.mockImplementationOnce(async()=>{e.records.set(original.attemptId,e.intent);throw Error('withheld committed reply');});
 vi.mocked(e.port.settleCarrier).mockReturnValueOnce(carrier.promise);
 const work=e.coordinator.retire(original);await until(()=>vi.mocked(e.port.settleCarrier).mock.calls.length===1);
 // The slot is reserved, not locally fenced. Durable intent still denies new producer authority.
 const lease=e.gate.acquire(e.key);await expect(lease.ready()).rejects.toThrow('retired');lease.finish();
 expect(e.port.read).not.toHaveBeenCalled();expect(e.installation.retireOutput).not.toHaveBeenCalled();
 carrier.resolve();expect((await work.result).ok).toBe(true);await work.settled;
 expect(e.port.begin).not.toHaveBeenCalled();expect(e.installation.retireOutput).toHaveBeenCalledTimes(1);
 expect(e.coordinator.status().retained).toBe(0);await e.coordinator.close();
});
it('releases an unfenced slot after positively reconciled no-commit funding refusal',async()=>{
 const e=model({rejected:true});e.funding.fundRejected.mockRejectedValueOnce(Error('capacity refusal'));
 const work=e.coordinator.retire(original);expect((await work.result).ok).toBe(false);await work.settled;
 expect(e.installation.retireOutput).not.toHaveBeenCalled();expect(e.coordinator.status().retained).toBe(0);
 const lease=e.gate.acquire(e.key);await lease.ready();lease.finish();
 const retry=e.coordinator.retire(original);expect((await retry.result).ok).toBe(true);await retry.settled;await e.coordinator.close();
});
it('keeps unknown funding termination owned without a fence, drain or producer proof',async()=>{
 const e=model({rejected:true});e.funding.fundRejected.mockRejectedValueOnce(Error('unknown funding'));
 vi.mocked(e.port.settleCarrier).mockRejectedValueOnce(Error('unknown worker termination'));
 const work=e.coordinator.retire(original);expect(await work.result).toEqual({ok:false,reason:'cleanup'});await work.settled;
 expect(e.port.read).not.toHaveBeenCalled();expect(e.installation.retireOutput).not.toHaveBeenCalled();
 expect(e.coordinator.status().retained).toBe(1);expect(()=>e.coordinator.retire(original)).toThrow('cleanup');
 await expect(e.coordinator.close()).rejects.toThrow('cleanup');
});
it('expires publicly while funding is pending and reconciles the durable fence without issuing a late proof',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});let now=100;
 const e=model({rejected:true,now:()=>now});const pending=deferred<typeof e.intent>();
 e.funding.fundRejected.mockImplementationOnce(()=>pending.promise);
 try{
  const work=e.coordinator.retire(original);await until(()=>e.funding.fundRejected.mock.calls.length===1);
  now+=30000;await vi.advanceTimersByTimeAsync(30000);expect(await work.result).toEqual({ok:false,reason:'expired'});
  expect(e.coordinator.status().retained).toBe(1);expect(e.installation.retireOutput).not.toHaveBeenCalled();
  e.records.set(original.attemptId,e.intent);pending.resolve(e.intent);await work.settled;
  expect(e.coordinator.status().retained).toBe(1);expect(()=>e.gate.acquire(e.key)).toThrow('retired');
  const retry=e.coordinator.retire(original);expect((await retry.result).ok).toBe(true);await retry.settled;
  expect(e.installation.retireOutput).toHaveBeenCalledTimes(1);await e.coordinator.close();
 }finally{vi.useRealTimers();}
});
it.each(['deadline','close'] as const)('dispatches no fresh reconciliation read after a held carrier outlives %s',async kind=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});let now=100;
 const e=model({rejected:true,now:()=>now});const carrier=deferred<void>();
 e.funding.fundRejected.mockImplementationOnce(async()=>{e.records.set(original.attemptId,e.intent);throw Error('lost funding reply');});
 vi.mocked(e.port.settleCarrier).mockReturnValueOnce(carrier.promise);
 try{
  const work=e.coordinator.retire(original);await until(()=>vi.mocked(e.port.settleCarrier).mock.calls.length===1);
  let closing:Promise<void>|undefined;
  if(kind==='deadline'){now+=30000;await vi.advanceTimersByTimeAsync(30000);}
  else{closing=e.coordinator.close();void closing.catch(()=>{});}
  expect(await work.result).toEqual({ok:false,reason:kind==='deadline'?'expired':'closed'});
  carrier.resolve();await work.settled;expect(e.port.read).not.toHaveBeenCalled();
  expect(e.installation.retireOutput).not.toHaveBeenCalled();expect(e.coordinator.status().retained).toBe(1);
  if(closing)await expect(closing).rejects.toThrow('cleanup');
  else{
   const retry=e.coordinator.retire(original);expect((await retry.result).ok).toBe(true);await retry.settled;
   expect(e.installation.retireOutput).toHaveBeenCalledTimes(1);await e.coordinator.close();
  }
 }finally{vi.useRealTimers();}
});
