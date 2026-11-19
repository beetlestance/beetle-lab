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

it('keeps the loopback origin by default, so existing installations keep their request digest', () => {
  const captured = composeOptions({ ...environment, BEETLE_COMPOSE_ORIGIN: '', BEETLE_COMPOSE_BIND: '', BEETLE_COMPOSE_ACCESS: '' });
  expect(captured.options.externalOrigin).toBe('http://127.0.0.1:4567');
  expect(captured.loopbackDefault).toBe('http://127.0.0.1:4567');
  expect(composeOptions(environment).options).toEqual(captured.options);
});

it('admits an HTTPS origin or a bind on another host only with network access (decision 032)', () => {
  const origin = 'https://lab.example.internal';
  const refused = (values: Record<string, string>) => {
    try { composeOptions({ ...environment, ...values }); } catch (error) { return (error as { code: string }).code; }
    return 'accepted';
  };
  expect(refused({ BEETLE_COMPOSE_ORIGIN: origin })).toBe('network_access_required');
  expect(refused({ BEETLE_COMPOSE_BIND: '0.0.0.0' })).toBe('network_access_required');
  expect(composeOptions({ ...environment, BEETLE_COMPOSE_ORIGIN: origin, BEETLE_COMPOSE_ACCESS: 'network' }).options.externalOrigin).toBe(origin);
  expect(refused({ BEETLE_COMPOSE_ORIGIN: origin, BEETLE_COMPOSE_BIND: '100.64.0.7', BEETLE_COMPOSE_ACCESS: 'network' })).toBe('accepted');
  for (const values of [
    { BEETLE_COMPOSE_ORIGIN: 'http://lab.example.internal', BEETLE_COMPOSE_ACCESS: 'network' },
    { BEETLE_COMPOSE_ORIGIN: `${origin}/`, BEETLE_COMPOSE_ACCESS: 'network' },
    { BEETLE_COMPOSE_ORIGIN: origin, BEETLE_COMPOSE_BIND: '::', BEETLE_COMPOSE_ACCESS: 'network' },
    { BEETLE_COMPOSE_ORIGIN: origin, BEETLE_COMPOSE_BIND: 'lab.example.internal', BEETLE_COMPOSE_ACCESS: 'network' },
    { BEETLE_COMPOSE_BIND: '0.0.0.0', BEETLE_COMPOSE_ACCESS: 'network' },
    { BEETLE_COMPOSE_ACCESS: 'public' },
  ]) expect(refused(values)).toBe('invalid_input');
});
