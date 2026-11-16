import { join } from 'node:path';
import type { Fixture } from '../../../agent/test/container/fixture.js';
/** Shared qualification recipe. Replacement never changes the installation or verified mounts. */
export function agentContainerArguments(f:Fixture,control:string,seed=false):string[]{
 const mounts=['staging','journal','inputs','config'].flatMap(name=>['--mount',`type=bind,src=${join(f.root,name)},dst=${join(f.root,name)}${['inputs','config'].includes(name)?',readonly':''}`]);
 const args=['create','--pull','never','--name',f.agent,'--label',`dev.beetle.qualification=${f.id}`,'--network',control,
  '--publish','127.0.0.1::4312','--user',f.user,'--group-add','0','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
  '--cpus','1','--memory','512m','--pids-limit','128','--log-driver','local','--log-opt','max-size=1m','--log-opt','max-file=2',
  '--tmpfs',`/tmp:rw,nosuid,nodev,size=33554432,uid=${f.uid},gid=${f.gid}`,...mounts,
  '--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','--env',`BEETLE_AGENT_CONFIG_FILE=${f.configPath}`];
 if(seed)args.push('--entrypoint','node');args.push(f.agentImage.Id);
 if(seed)args.push('/beetle/qualification/no-task-seed.js',f.configPath,join(f.root,'config','seed-offer.json'));return args;
}
