import {afterEach, expect, it, vi} from 'vitest';
import {readReadyPublic} from './public.js';

afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('waits through a transient read with the same caller signal and returns the exact value',async()=>{
 vi.useFakeTimers();let calls=0;let original:AbortSignal|undefined;const expected={version:2};
 const pending=readReadyPublic(async signal=>{
  if(original)expect(signal).toBe(original);original=signal;calls++;
  return calls===1?{ok:false as const,error:{kind:'response' as const,status:503}}:{ok:true as const,value:expected};
 });
 await vi.advanceTimersByTimeAsync(250);expect(await pending).toBe(expected);expect(calls).toBe(2);
});
it.each([401,403,404,200,500])('refuses nontransient status %i immediately without new authentication',async status=>{
 const read=vi.fn(async()=>({ok:false as const,error:{kind:'response' as const,status}}));
 await expect(readReadyPublic(read)).rejects.toThrow('Unexpected authenticated readiness refusal');expect(read).toHaveBeenCalledTimes(1);
});
it('does not retry invalid requests or caller cancellation',async()=>{
 for(const kind of ['request','cancelled'] as const){
  const read=vi.fn(async()=>({ok:false as const,error:{kind}}));
  await expect(readReadyPublic(read)).rejects.toThrow('Unexpected authenticated readiness refusal');expect(read).toHaveBeenCalledTimes(1);
 }
});
it('refuses a late successful read and never grants readiness beyond its phase deadline',async()=>{
 const clock=vi.spyOn(performance,'now').mockReturnValue(0);
 await expect(readReadyPublic(async signal=>{expect(signal).toBeInstanceOf(AbortSignal);clock.mockReturnValue(45000);return{ok:true,value:'late'};}))
  .rejects.toThrow('Public readiness deadline');
});
it('exhausts the bounded retry count without granting readiness',async()=>{
 vi.useFakeTimers();const read=vi.fn(async()=>({ok:false as const,error:{kind:'response' as const,status:503}}));
 const rejected=expect(readReadyPublic(read)).rejects.toThrow('Public readiness deadline');await vi.runAllTimersAsync();await rejected;
 expect(read).toHaveBeenCalledTimes(100);
});
it.each([true,false])('honours the protocol retryable flag (%j) for a capacity refusal',async retryable=>{
 vi.useFakeTimers();let calls=0;
 const protocol={code:'capacity_unavailable' as const,message:'Capacity unavailable' as const,retryable,requestId:'00000000-0000-4000-8000-000000000010',fields:[]};
 const pending=readReadyPublic(async()=>++calls===1?{ok:false as const,error:{kind:'protocol' as const,status:503,protocol}}:{ok:true as const,value:'ready'});
 if(!retryable){await expect(pending).rejects.toThrow('Unexpected authenticated readiness refusal');expect(calls).toBe(1);return;}
 await vi.advanceTimersByTimeAsync(250);expect(await pending).toBe('ready');expect(calls).toBe(2);
});
