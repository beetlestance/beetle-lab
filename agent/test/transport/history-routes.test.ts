import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {expect,it,vi} from 'vitest';
import type {LiveMetricHistory} from '@beetle/contracts/api';
import type {AgentHttpOptions} from '../../src/transport/index.js';
import type {HistoryRead} from '../../src/supervisor/index.js';
import {sourceFixture,deferred} from './source-fixture.js';
const f=sourceFixture();
async function setup(){
 const value=JSON.parse(await readFile('contracts/fixtures/valid/live-metric-history.json','utf8')) as LiveMetricHistory;
 const read=vi.fn<NonNullable<AgentHttpOptions['liveHistory']>>(async()=>({ok:true,value}));
 const e=await f.server(false,undefined,read);value.scope=e.key;value.prefix.scope=e.key;
 return {...e,value,read,pathHistory:e.path.replace('/source','/live-history')};
}
it('serves approved history with independent30second budget and no current-window freshness claim',async()=>{
 const e=await setup();const start=performance.now();const response=await e.server.inject({url:e.pathHistory,headers:e.headers});
 expect(response.statusCode).toBe(200);expect(response.json()).toEqual(e.value);expect(response.headers).toMatchObject({'cache-control':'no-store',connection:'close'});
 expect(response.headers['x-beetle-live-fresh-for-ms']).toBeUndefined();expect(e.read.mock.calls[0]![1].deadline).toBeGreaterThan(start+25000);expect(e.unused).not.toHaveBeenCalled();
});
it('rejects wrong authority, browser headers, query selectors and bodies before native service effects',async()=>{
 const e=await setup();for(const change of [{headers:{...e.headers,authorization:'Bearer invalid'}},{headers:{...e.headers,origin:'https://synthetic.invalid'}},{headers:{...e.headers,'x-beetle-generation':'2'}},{url:e.pathHistory+'?path=secret'},{headers:{...e.headers,'content-length':'2'},payload:'{}'}]){
  expect((await e.server.inject({url:e.pathHistory,headers:e.headers,...change})).statusCode).toBeGreaterThanOrEqual(400);
 }expect(e.read).not.toHaveBeenCalled();
});
it('rejects malformed or out-of-scope history without exposing native exceptions',async()=>{
 const e=await setup();const wrong=structuredClone(e.value);wrong.scope.generation=2;
 const hostile=structuredClone(e.value);Object.defineProperty(hostile,'samples',{get(){throw Error('PRIVATE_SENTINEL')}});
 const port=await f.listen(e.server);
 for(const value of [wrong,hostile]){
  e.read.mockResolvedValueOnce({ok:true,value});const client=f.raw(port,e.pathHistory,e.headers);
  const closed=new Promise(resolve=>client.client.once('close',resolve));client.client.end();
  const response=await client.response;await closed;
  expect(response.status).toBe(503);expect(response.body).not.toContain('PRIVATE_SENTINEL');
  await expect.poll(()=>e.read.mock.calls.at(-1)?.[1].signal?.aborted).toBe(true);
 }
});
it('retains its single history credit after disconnect until the ignored service original settles',async()=>{
 const e=await setup();const gate=deferred<HistoryRead>();e.read.mockImplementation(()=>gate.promise);const port=await f.listen(e.server);const client=f.raw(port,e.pathHistory,e.headers);client.client.end();
 try{
  await expect.poll(()=>e.read.mock.calls.length).toBe(1);client.client.destroy();await client.response;await expect.poll(()=>e.read.mock.calls[0]![1].signal?.aborted).toBe(true);
  expect((await e.server.inject({url:e.pathHistory,headers:e.headers})).statusCode).toBe(429);
  expect((await e.server.inject({url:e.path,headers:e.headers})).statusCode).toBe(200);
  expect((await e.server.inject({url:'/runner/v1/capabilities',headers:e.headers})).statusCode).toBe(200);
 }finally{gate.resolve({ok:true,value:e.value});}
 await new Promise(resolve=>setImmediate(resolve));e.read.mockResolvedValue({ok:true,value:e.value});
 expect((await e.server.inject({url:e.pathHistory,headers:e.headers})).statusCode).toBe(200);
});
