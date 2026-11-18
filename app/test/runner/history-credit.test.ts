import {expect,it,vi} from 'vitest';
import type {ClientResult} from '@beetle/contracts';
import {CallCredits} from '../../src/adapters/outbound/runner/lifetime.js';
import {deferred} from './fixtures.js';
it('allows history beyond5s, stops at30s and retains its credit until the original settles',async()=>{
 vi.useFakeTimers();const credits=new CallCredits();const gate=deferred<ClientResult<number>>();let signal:AbortSignal|undefined;
 const read=credits.run<number>('history',undefined,async call=>{signal=call.signal;return gate.promise});
 try{
  await vi.advanceTimersByTimeAsync(5000);expect(signal?.aborted).toBe(false);await vi.advanceTimersByTimeAsync(25000);expect(signal?.aborted).toBe(true);
  expect(await credits.run<number>('history',undefined,async()=>({ok:true,value:1}))).toMatchObject({ok:false});
  let closed=false;const closing=credits.close().then(()=>{closed=true});await Promise.resolve();expect(closed).toBe(false);
  gate.resolve({ok:false,error:{kind:'timeout'}});expect(await read).toMatchObject({ok:false,error:{kind:'timeout'}});await closing;
 }finally{gate.resolve({ok:false,error:{kind:'timeout'}});await read;await credits.close();vi.useRealTimers();}
});
