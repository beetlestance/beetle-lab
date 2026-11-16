import { expect,it } from 'vitest';
import { createServer,request } from 'node:http';
import value from '../../../../contracts/fixtures/valid/output-settlement-request.json' with {type:'json'};
import reply from '../../../../contracts/fixtures/valid/output-settlement-reply.json' with {type:'json'};
import { retirementProxy } from './proxy.js';
import { bounded } from './metadata.js';
it('drops only the first exact settled reply, retains the real TCP original and validates later replay',async()=>{
 let calls=0;const upstream=createServer((incoming,response)=>{incoming.resume();incoming.once('end',()=>{calls++;response.setHeader('content-type','application/json');response.end(JSON.stringify(reply));});});
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const address=upstream.address();if(!address||typeof address==='string')throw Error('No address');
 const proxy=await retirementProxy(`http://127.0.0.1:${address.port}`,1000,true);
 const post=()=>new Promise<string>((resolve,reject)=>{const req=request(new URL(`/runner/v1/attempts/${value.retirement.attemptId}/output-settlement`,proxy.origin),{method:'POST',agent:false},response=>{
  const chunks:Buffer[]=[];response.on('data',(chunk:Buffer)=>chunks.push(chunk));response.once('error',reject);response.once('end',()=>resolve(Buffer.concat(chunks).toString()));
 });req.once('error',reject);req.end(JSON.stringify(value));});
 try{
  await expect(bounded(post(),'No dropped reply')).rejects.toBeDefined();const observed=await bounded(proxy.settlement,'No committed observation');
  expect(observed.request).toEqual(value);expect(observed.reply).toEqual(reply);await expect(bounded(post(),'Paused retry did not close')).rejects.toBeDefined();
  expect(calls).toBe(1);expect(proxy.state().settlement.blocked).toBe(1);proxy.releaseSettlement();expect(JSON.parse(await post())).toEqual(reply);
  await proxy.close();expect(proxy.state().active).toBe(0);expect(proxy.state().settlement).toMatchObject({calls:3,replies:2,dropped:true});expect(calls).toBe(2);
 }finally{await proxy.close();await new Promise<void>((resolve,reject)=>upstream.close(error=>error?reject(error):resolve()));}
});
