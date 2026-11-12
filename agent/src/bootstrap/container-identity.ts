import {openSync,readSync,closeSync,statSync} from 'node:fs';
export interface IdentityPort {
 uid():number;gid():number;euid():number;egid():number;groups():number[];
 setGroups(groups:number[]):void;setGid(gid:number):void;setUid(uid:number):void;
 socket():{isSocket():boolean;gid:number};capabilities():string;
}
const native:IdentityPort={uid:()=>process.getuid!(),gid:()=>process.getgid!(),euid:()=>process.geteuid!(),egid:()=>process.getegid!(),groups:()=>process.getgroups!(),
 setGroups:groups=>process.setgroups!(groups),setGid:gid=>process.setgid!(gid),setUid:uid=>process.setuid!(uid),
 socket:()=>statSync('/var/run/docker.sock'),capabilities:()=>{
  const fd=openSync('/proc/self/status','r');try{const bytes=Buffer.alloc(8193);const length=readSync(fd,bytes,0,bytes.length,0);
   if(length>8192)throw Error('Identity status bound');return bytes.subarray(0,length).toString('utf8');
  }finally{closeSync(fd);}
 }};
function requireIdentity(value:unknown):asserts value{if(!value)throw Error('Container identity refused');}
/** Packaging-only identity adoption. Existing agent/installer startup runs afterward. */
export function enterContainerIdentity():void{adoptIdentity(native);}
/** Private deterministic process seam; no real privilege changes in unit tests. */
export function adoptIdentity(port:IdentityPort):void{
 const socket=port.socket();requireIdentity(socket.isSocket()&&Number.isSafeInteger(socket.gid)&&socket.gid>=0&&socket.gid<=4294967294);
 requireIdentity(port.uid()===0&&port.euid()===0);
 port.setGroups([socket.gid]);port.setGid(1000);port.setUid(1000);
 verifyIdentity(port,socket.gid);
}
function verifyIdentity(port:IdentityPort,socketGroup:number):void{
 requireIdentity(port.uid()===1000&&port.euid()===1000&&port.gid()===1000&&port.egid()===1000);
 const groups=port.groups();requireIdentity(groups.length<=2&&groups.includes(socketGroup)&&groups.every(gid=>gid===1000||gid===socketGroup));
 const status=port.capabilities();
 for(const kind of ['CapEff','CapPrm','CapAmb'])requireIdentity(new RegExp('^'+kind+':\\s+0+$','m').test(status));
}
