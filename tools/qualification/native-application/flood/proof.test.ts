import {expect,it} from 'vitest';
import {refusal} from './proof.js';
it('closes an unexpected successful content body instead of leaking its original',async()=>{
 let cancelled=false;const body=new ReadableStream({cancel(){cancelled=true;}});
 await expect(refusal(new Response(body,{status:200}))).rejects.toThrow();expect(cancelled).toBe(true);
});
it('accepts only a bounded typed capacity refusal',async()=>{
 expect(await refusal(new Response(JSON.stringify({code:'capacity_unavailable'}),{status:503}))).toEqual({status:503,code:'capacity_unavailable'});
 await expect(refusal(new Response(JSON.stringify({code:'storage_unavailable'}),{status:503}))).rejects.toThrow();
});
