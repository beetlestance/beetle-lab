import {afterEach,expect,it,vi} from 'vitest';
import {readyContent} from './content-readiness.js';
afterEach(()=>vi.useRealTimers());
const refusal=(retryable=true)=>new Response(JSON.stringify({code:'capacity_unavailable',message:'Capacity unavailable',retryable,
 requestId:'00000000-0000-4000-8000-000000000010',fields:[]}),{status:503,headers:{'content-type':'application/json'}});
it('retries only an explicit bounded capacity refusal with the same phase signal',async()=>{
 vi.useFakeTimers();let calls=0;let original:AbortSignal|undefined;const success=new Response('owned bytes');
 const pending=readyContent(async signal=>{if(original)expect(signal).toBe(original);original=signal;return ++calls===1?refusal():success;});
 await vi.advanceTimersByTimeAsync(250);expect(await pending).toBe(success);expect(calls).toBe(2);
});
it.each([403,409,500])('does not retry permanent HTTP %i refusals',async status=>{
 const get=vi.fn(async()=>new Response('SYNTHETIC_PRIVATE_BODY',{status}));
 await expect(readyContent(get)).rejects.toThrow(`response/${status}/none`);expect(get).toHaveBeenCalledTimes(1);
});
it.each(['not-retryable','invalid','oversize'] as const)('refuses %s capacity bodies without another GET',async kind=>{
 const get=vi.fn(async()=>kind==='not-retryable'?refusal(false):new Response(kind==='oversize'?'x'.repeat(4097):'SYNTHETIC_PRIVATE_BODY',
  {status:503,headers:{'content-type':'application/json'}}));
 await expect(readyContent(get)).rejects.toThrow('response/503/none');expect(get).toHaveBeenCalledTimes(1);
});
it('cancels an overly fragmented refusal before granting another request',async()=>{
 let cancelled=0;const response=new Response(new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array([32]));},cancel(){cancelled++;}}),
  {status:503,headers:{'content-type':'application/json'}});
 const get=vi.fn(async()=>response);await expect(readyContent(get)).rejects.toThrow('response/503/none');expect(get).toHaveBeenCalledTimes(1);expect(cancelled).toBe(1);
});
