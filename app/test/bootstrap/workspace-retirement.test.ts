import {expect,it} from 'vitest';
import {join} from 'node:path';
import {realpath} from 'node:fs/promises';
import {apiOperations} from '@beetle/contracts/api';
import type {BrowserSession} from '@beetle/contracts/api';
import {openApplication} from '../../src/bootstrap/api.js';
import {storageFixture,settingsFixture,observation,seed,scope,uuid,requestId} from '../storage/fixture.js';
import {createSuite,append} from '../storage/suites-fixture.js';
const fixture=storageFixture();const host='127.0.0.1:43127';const origin='http://'+host;
it('hides retained workspace contents across every configured workspace route and replays DELETE after restart',async()=>{
 const path=fixture.path();const metadata=await fixture.open(path);await seed(metadata);await append(metadata,await createSuite(metadata));await fixture.close(metadata);
 const settings=settingsFixture();const root=await realpath(fixture.root());
 const options={externalOrigin:origin,inputsDirectory:join(root,'retirement-inputs'),metadata:{path,workerUrl:fixture.workerUrl(),installation:settings.chain.installation,runtime:observation()}};
 let app=await openApplication(options);
 const pair=async()=>{
  const response=await app.server.inject({method:'POST',url:'/api/v2/auth/pair',headers:{host,origin,'x-beetle-pair':'1'},payload:{bootstrapToken:app.bootstrapToken}});
  expect(response.statusCode).toBe(200);return {host,origin,cookie:String(response.headers['set-cookie']).split(';')[0]!,'x-beetle-csrf':response.json<BrowserSession>().csrfToken};
 };
 try{
  let headers=await pair();const base=`/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}`;
  for(const suffix of ['', '/settings','/suites?limit=10','/runs?limit=10','/overview'])expect((await app.server.inject({method:'GET',url:base+suffix,headers})).statusCode,suffix).toBe(200);
  const payload={scope:{kind:'organization',organizationId:scope.organizationId},requestId:requestId(),expectedVersion:1};
  const deleted=await app.server.inject({method:'DELETE',url:base,headers,payload});expect(deleted.statusCode).toBe(200);const ack=deleted.json<unknown>();
  for(const operation of apiOperations.filter(item=>item.path.includes('{workspaceId}')&&item.name!=='deleteWorkspace')){
   const url=operation.path.replace(/\{([A-Za-z]+)\}/g,(_match,key:string)=>key==='organizationId'?scope.organizationId:key==='workspaceId'?scope.workspaceId:uuid(990));
   const response=await app.server.inject({method:operation.method,url,headers,...(operation.method==='GET'?{}:{payload:'invalid JSON'})});
   expect(response.statusCode,operation.name).toBe(404);
  }
  const list=await app.server.inject({method:'GET',url:`/api/v2/organizations/${scope.organizationId}/workspaces?limit=10`,headers});
  expect(list.json<{items:unknown[]}>().items).toEqual([]);
  await app.close();app=await openApplication(options);headers=await pair();
  const replay=await app.server.inject({method:'DELETE',url:base,headers,payload});expect(replay.statusCode).toBe(200);expect(replay.json<unknown>()).toEqual(ack);
 }finally{await app.close();}
});
