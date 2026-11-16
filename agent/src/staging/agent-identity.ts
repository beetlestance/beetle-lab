import {openSync,readSync,closeSync} from 'node:fs';
import {StagingError} from './types.js';
import type {InstallationConfiguration} from './types.js';
interface RuntimeIdentity {pid:number;uid:number;gid:number;euid:number;egid:number;status:string}
function safe(value:unknown):asserts value{if(!value)throw new StagingError('installation');}
function record(value:unknown):Record<string,unknown>{safe(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,unknown>;}
function exact(actual:unknown,expected:readonly string[]):boolean{return Array.isArray(actual)&&actual.length===expected.length&&expected.every(value=>actual.includes(value));}
function runtimeIdentity():RuntimeIdentity{
 const fd=openSync('/proc/self/status','r');
 try{const bytes=Buffer.alloc(8193);const length=readSync(fd,bytes,0,bytes.length,0);safe(length<=8192);
  return {pid:process.pid,uid:process.getuid!(),gid:process.getgid!(),euid:process.geteuid!(),egid:process.getegid!(),status:bytes.subarray(0,length).toString('utf8')};
 }finally{closeSync(fd);}
}
/** Explicit packaging mode only; ordinary non-root container identity stays unchanged. */
export function verifyAgentIdentity(raw:Record<string,unknown>,configuration:InstallationConfiguration,runtime:()=>RuntimeIdentity=runtimeIdentity):void{
 const config=record(raw.Config);
 if(configuration.agentIdentity===undefined){safe(config.User===configuration.user);return;}
 safe(configuration.agentIdentity==='socket-group-drop-v1'&&configuration.user==='1000:1000');
 bootstrapRecipe(raw,config);
 droppedProcess(runtime());
}
function bootstrapRecipe(raw:Record<string,unknown>,config:Record<string,unknown>):void{
 safe(config.User==='0:0'&&Array.isArray(config.Entrypoint)&&config.Entrypoint.length===2&&config.Entrypoint[0]==='node'&&config.Entrypoint[1]==='/beetle/agent/container.js');
 safe(config.Cmd===null||exact(config.Cmd,[]));
 bootstrapPrivileges(record(raw.HostConfig));
}
function bootstrapPrivileges(host:Record<string,unknown>):void{
 safe(host.Init===false&&host.Privileged===false&&host.PidMode==='');
 safe(exact(host.CapDrop,['ALL'])&&exact(host.CapAdd,['CAP_SETGID','CAP_SETUID'])&&exact(host.SecurityOpt,['no-new-privileges:true']));
}
function droppedProcess(actual:RuntimeIdentity):void{
 safe(actual.pid===1&&actual.uid===1000&&actual.euid===1000&&actual.gid===1000&&actual.egid===1000);
 for(const kind of ['CapEff','CapPrm','CapAmb'])safe(new RegExp('^'+kind+':\\s+0+$','m').test(actual.status));
}
