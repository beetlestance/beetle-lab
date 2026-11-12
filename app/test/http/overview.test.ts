import {expect,it,vi} from 'vitest';
import {encodeJson} from '@beetle/contracts';
import {apiSchemas} from '@beetle/contracts/api';
import type {WorkspaceOverview,BrowserSession} from '@beetle/contracts/api';
import {createApiServer} from '../../src/adapters/inbound/http/api-errors.js';
import {configureSchemaCompilers} from '../../src/adapters/inbound/http/schema-compilers.js';
import {createLocalSession} from '../../src/adapters/inbound/http/session/index.js';
import {registerOverviewRoute} from '../../src/adapters/inbound/http/overview/index.js';
import type {OverviewReader} from '../../src/ports/overview.js';
import snapshot from '../../../contracts/fixtures/api/valid/workspace-overview.json';
it('authorizes the fixed read, binds scope and trusted clock, and rejects foreign reader output',async()=>{
 const server=createApiServer();configureSchemaCompilers(server,{schemas:apiSchemas,encodeJson});
 const host='127.0.0.1:43127';const origin=`http://${host}`;const session=createLocalSession({externalOrigin:origin});session.registerRoutes(server);
 const value=structuredClone(snapshot) as WorkspaceOverview;const read=vi.fn<OverviewReader['read']>(async()=>value);
 registerOverviewRoute(server,{reader:{read},authorize:session.authorize,now:()=>value.generatedAt});
 const path=`/api/v2/organizations/${value.scope.organizationId}/workspaces/${value.scope.workspaceId}/overview`;
 try{
  expect((await server.inject({url:path,headers:{host}})).statusCode).toBe(401);expect(read).not.toHaveBeenCalled();
  const pair=await server.inject({method:'POST',url:'/api/v2/auth/pair',headers:{host,origin,'x-beetle-pair':'1'},payload:{bootstrapToken:session.bootstrapToken}});
  expect(pair.statusCode).toBe(200);expect(pair.json<BrowserSession>().csrfToken).toBeDefined();const cookie=String(pair.headers['set-cookie']).split(';')[0]!;
  const response=await server.inject({url:path,headers:{host,cookie}});expect(response.statusCode).toBe(200);expect(response.json()).toEqual(value);
  expect(read).toHaveBeenCalledWith({scope:value.scope,now:value.generatedAt});
  const foreign=structuredClone(value);foreign.scope.workspaceId='00000000-0000-4000-8000-000000000099';read.mockResolvedValue(foreign);
  expect((await server.inject({url:path,headers:{host,cookie}})).statusCode).toBe(404);
  read.mockResolvedValue(value);const fixed=await server.inject({url:path+'?limit=10000&from=0',headers:{host,cookie}});
  expect(fixed.statusCode).toBe(200);expect(fixed.json()).toEqual(value);expect(read).toHaveBeenLastCalledWith({scope:value.scope,now:value.generatedAt});
 }finally{session.close();await server.close();}
});
