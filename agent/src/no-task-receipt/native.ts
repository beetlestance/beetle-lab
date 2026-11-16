import { daemonResources,mailboxVolumeName } from '../backends/docker/index.js';
import type { DockerTransport,Operation } from '../backends/docker/index.js';
import { InventoryRoot,requireInventory } from '../task-inventory/index.js';
import type { InventoryPorts } from '../task-inventory/index.js';
import type { OutputIO } from '../collection/output/index.js';
import type { noTaskScope } from './authority.js';
type Scope=ReturnType<typeof noTaskScope>;
async function absentPath(io:OutputIO,ports:InventoryPorts,path:string):Promise<void>{
 try{await io.io(()=>ports.lstat(path,{bigint:true}));}
 catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT'){io.check();return;}throw error;}
 requireInventory(false);
}
async function absentRuntime(io:OutputIO,transport:DockerTransport,scope:Scope,operation:Operation):Promise<void>{
 const version=await io.io(()=>transport.request({...operation,method:'GET',path:'/version'}));
 const info=await io.io(()=>transport.request({...operation,method:'GET',path:'/v1.47/info'}));
 requireInventory(daemonResources(version,info,scope.daemonId).ok);
 const container=await io.io(()=>transport.request({...operation,method:'GET',path:`/v1.47/containers/${scope.name}/json`}));
 requireInventory(container.ok&&container.status===404);
 const volume=await io.io(()=>transport.request({...operation,method:'GET',path:`/v1.47/volumes/${mailboxVolumeName(scope.name)}`}));
 requireInventory(volume.ok&&volume.status===404);
}
/** Pinned read-only absence proof. No unlink, directory preparation or container mutation. */
export async function observeNoTask(input:{scope:Scope;io:OutputIO;ports:InventoryPorts;transport:DockerTransport;operation:Operation}):Promise<()=>Promise<void>>{
 const{scope,io,ports,transport,operation}=input;requireInventory(ports.platform==='linux');
 const root=new InventoryRoot(scope.root,io,ports);const parent=await root.open();
 await absentRuntime(io,transport,scope,operation);await absentPath(io,ports,ports.child(parent,scope.name));
 await root.namedCheck();await absentPath(io,ports,ports.child(parent,scope.name));await root.namedCheck();
 return async()=>{
  await root.namedCheck();await absentPath(io,ports,scope.directory);await absentRuntime(io,transport,scope,operation);
  await root.namedCheck();await absentPath(io,ports,scope.directory);await root.namedCheck();
 };
}
