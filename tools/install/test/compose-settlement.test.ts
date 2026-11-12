import {expect,it,vi} from 'vitest';
import {performance} from 'node:perf_hooks';
import {settleSetup} from '../compose/settlement.js';
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
it('retains the gate through original close and refuses a positive commit after the fixed deadline',async()=>{
 const held=deferred();const gate={close:vi.fn(async()=>{})};const operation={signal:new AbortController().signal,deadline:performance.now()+5};
 const error=vi.spyOn(process.stderr,'write').mockReturnValue(true);
 try{const done=settleSetup({home:{close:()=>held.promise},gate,success:true,operation});await new Promise(resolve=>setTimeout(resolve,10));expect(gate.close).not.toHaveBeenCalled();
  held.resolve();expect(await done).toBe(false);expect(gate.close).toHaveBeenCalledExactlyOnceWith(false);expect(error).toHaveBeenCalledWith('deadline\n');
 }finally{error.mockRestore();}
});
it('keeps the gate retained on unknown home close and never retries it',async()=>{
 const gate={close:vi.fn(async()=>{})};const error=vi.spyOn(process.stderr,'write').mockReturnValue(true);
 try{expect(await settleSetup({home:{close:async()=>{throw Error('Unknown close');}},gate,success:true,operation:{signal:new AbortController().signal,deadline:performance.now()+1000}})).toBe(false);
  expect(gate.close).not.toHaveBeenCalled();
 }finally{error.mockRestore();}
});
it('commits only after known home settlement within the unchanged deadline',async()=>{
 const order:string[]=[];const result=await settleSetup({home:{close:async()=>{order.push('home');}},gate:{close:async success=>{expect(success).toBe(true);order.push('gate');}},
  success:true,operation:{signal:new AbortController().signal,deadline:performance.now()+1000}});
 expect(result).toBe(true);expect(order).toEqual(['home','gate']);
});
