import {expect,it,vi} from 'vitest';
import {composeOptions} from '../compose/options.js';
import {createStarterRequest} from '../starter.js';
const environment={BEETLE_COMPOSE_HOME:'/synthetic/home',BEETLE_COMPOSE_INSTANCE:'synthetic',BEETLE_COMPOSE_PORT:'4567',BEETLE_COMPOSE_AGENT_IMAGE:'synthetic-agent:v1',BEETLE_COMPOSE_ENGINE_IMAGE:'synthetic-engine:v1',BEETLE_COMPOSE_EXPORT_IMAGE:'synthetic-export:v1'};
it('captures only deployment options before identity drop and validates the request only afterward',()=>{
 const uid=vi.spyOn(process,'getuid');const gid=vi.spyOn(process,'getgid');
 try{uid.mockReturnValue(0);gid.mockReturnValue(0);const captured=composeOptions(environment);
  expect(captured.home).toBe(environment.BEETLE_COMPOSE_HOME);expect(captured.options.agentIdentity).toBe('socket-group-drop-v1');
  expect(uid).not.toHaveBeenCalled();expect(gid).not.toHaveBeenCalled();expect(()=>createStarterRequest(captured.options)).toThrow();
  uid.mockReturnValue(1000);gid.mockReturnValue(1000);const request=createStarterRequest(captured.options);
  expect(request.agentIdentity).toBe('socket-group-drop-v1');expect(request.exportEngine?.sourceProfileId).toBe('k6-local');
 }finally{uid.mockRestore();gid.mockRestore();}
});
