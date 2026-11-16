import {join} from 'node:path';
import type {StarterOptions} from '../starter.js';
import {ProvisionError} from '../types.js';
const names=['BEETLE_COMPOSE_HOME','BEETLE_COMPOSE_INSTANCE','BEETLE_COMPOSE_PORT','BEETLE_COMPOSE_AGENT_IMAGE','BEETLE_COMPOSE_ENGINE_IMAGE','BEETLE_COMPOSE_EXPORT_IMAGE'] as const;
/** Only six explicit Compose packaging values are captured; credentials are generated later. */
export function composeOptions(environment:Readonly<Record<string,string|undefined>>){
 const values=Object.fromEntries(names.map(name=>[name,environment[name]]));
 const home=values.BEETLE_COMPOSE_HOME;const instance=values.BEETLE_COMPOSE_INSTANCE;const port=values.BEETLE_COMPOSE_PORT;
 if(typeof home!=='string'||typeof instance!=='string'||!/^[a-z0-9][a-z0-9-]{0,47}$/.test(instance)
  ||typeof port!=='string'||!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)throw new ProvisionError('invalid_input');
 const agentImage=values.BEETLE_COMPOSE_AGENT_IMAGE;const engineImage=values.BEETLE_COMPOSE_ENGINE_IMAGE;const exportEngineImage=values.BEETLE_COMPOSE_EXPORT_IMAGE;
 if(!agentImage||!engineImage||!exportEngineImage)throw new ProvisionError('invalid_input');
 const options:StarterOptions={root:join(home,'data'),uid:1000,gid:1000,externalOrigin:`http://127.0.0.1:${port}`,
  agentOrigin:'http://agent:4312',dockerSocket:'/var/run/docker.sock',agentContainer:`beetle-${instance}-agent`,agentImage,agentIdentity:'socket-group-drop-v1',engineImage,exportEngineImage,
  targetNetwork:`beetle-${instance}-targets`};return {home,options};
}
