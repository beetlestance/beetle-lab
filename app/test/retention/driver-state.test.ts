import { expect,it,vi } from 'vitest';
import type { RetentionDriverState } from '@beetle/contracts/api';
import { storageFixture } from '../storage/fixture.js';
import { selected } from './apply-fixture.js';
import { scope,uuid } from './fixture.js';
import { http,headers } from './http-fixture.js';
const storage=storageFixture();
it('reads driver advisory only after scoped metadata and never changes authoritative progress, charges or credit',async()=>{
 const f=selected();f.apply.apply(f.input);const path=storage.path();f.db.prepare('VACUUM INTO ?').run(path);const installation=f.settings.chain(scope).installation;f.db.close();
 const metadata=await storage.open(path,{runtime:null,runs:f.config,installation});let state:RetentionDriverState='running';let broken=false;
 const read=vi.fn(()=>{if(broken)throw Error('SYNTHETIC_PRIVATE_DRIVER_ERROR');return state;});const server=http(metadata,false,read);
 const url=`/api/v2/organizations/${scope.organizationId}/workspaces/${scope.workspaceId}/retention-batches/${f.page.id}`;const amount=(await metadata.inputs.storage()).chargedBytes;
 try{
  expect((await server.inject({url})).statusCode).toBe(401);expect((await server.inject({url:url.replace(scope.workspaceId,uuid(99000)),headers})).statusCode).toBe(404);expect(read).not.toHaveBeenCalled();
  const running=(await server.inject({url,headers})).json<Record<string,unknown>>();expect(running.driverState).toBe('running');
  state='stopped';const stopped=(await server.inject({url,headers})).json<Record<string,unknown>>();expect(stopped).toEqual({...running,driverState:'stopped'});expect(stopped.completedCount).toBe(0);expect(stopped.refundedLogicalBytes).toBe(0);
  broken=true;const unknown=await server.inject({url,headers});expect(unknown.statusCode).toBe(200);expect(unknown.json().driverState).toBe('unknown');expect(unknown.body).not.toContain('SYNTHETIC_PRIVATE_DRIVER_ERROR');
  broken=false;state='SYNTHETIC_INVALID_STATE' as RetentionDriverState;expect((await server.inject({url,headers})).json().driverState).toBe('unknown');expect((await metadata.inputs.storage()).chargedBytes).toBe(amount);
  state='stopped';const member=f.page.candidates[0]!;await metadata.outputSettlements.settle({key:{scope,id:member.deletionId,runId:member.id},agentReply:null});
  const partial=(await server.inject({url,headers})).json();expect(partial).toMatchObject({driverState:'stopped',state:'applied',completedCount:1,refundedLogicalBytes:62976});expect((await metadata.inputs.storage()).chargedBytes).toBe(amount-62976);
 }finally{await server.close();await storage.close(metadata);}
});
