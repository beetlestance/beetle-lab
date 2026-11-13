import {expect,it} from 'vitest';
import {join} from 'node:path';
import {realpath} from 'node:fs/promises';
import {apiOperations} from '@beetle/contracts/api';
import {openApplication} from '../../src/bootstrap/api.js';
import {storageFixture,settingsFixture,observation} from '../storage/fixture.js';
import {createApiServer} from '../../src/adapters/inbound/http/api-errors.js';
import {registerApiOperation} from '../../src/adapters/inbound/http/api-route.js';
const fixture=storageFixture();
it('matches all declared implementation statuses to the real configured application routes',async()=>{
 const settings=settingsFixture();const root=await realpath(fixture.root());const app=await openApplication({externalOrigin:'http://127.0.0.1:43127',inputsDirectory:join(root,'inputs'),
  metadata:{path:fixture.path(),workerUrl:fixture.workerUrl(),installation:settings.chain.installation,runtime:observation()}});
 try{
  await app.server.ready();
  const mismatches=apiOperations.filter(operation=>app.server.hasRoute({method:operation.method,url:operation.path.replace(/\{([A-Za-z]+)\}/g,':$1')})!==(operation.implementation==='implemented'));
  expect(mismatches.map(operation=>operation.name)).toEqual([]);
  expect(apiOperations.filter(operation=>operation.implementation==='planned').map(operation=>operation.name)).toEqual(["deleteOrganization", "deleteWorkspace", "deleteFolder"]);
 }finally{await app.close();}
});
it('refuses to register planned contract operations as implemented handlers',async()=>{
 const server=createApiServer();
 try{
  for(const operation of apiOperations.filter(row=>row.implementation==='planned')){
   expect(()=>registerApiOperation(server,operation.name,async()=>{throw Error('must not invoke');})).toThrow('planned, not implemented');
  }
 }finally{await server.close();}
});
