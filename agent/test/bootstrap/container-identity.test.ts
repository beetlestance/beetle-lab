import {expect,it} from 'vitest';
import {adoptIdentity} from '../../src/bootstrap/container-identity.js';
import type {IdentityPort} from '../../src/bootstrap/container-identity.js';
function fixture(){
 let uid=0;let gid=0;let groups:number[]=[];const calls:string[]=[];
 const port:IdentityPort={uid:()=>uid,euid:()=>uid,gid:()=>gid,egid:()=>gid,groups:()=>groups,
  setGroups:value=>{calls.push('groups');groups=value;},setGid:value=>{calls.push('gid');gid=value;},setUid:value=>{calls.push('uid');uid=value;},
  socket:()=>({isSocket:()=>true,gid:987}),capabilities:()=> 'CapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapAmb:\t0000000000000000\n'};
 return {port,calls};
}
it('sets only the actual socket group, drops identity and verifies all effective privileges before startup',()=>{
 const f=fixture();adoptIdentity(f.port);expect(f.calls).toEqual(['groups','gid','uid']);expect(f.port.uid()).toBe(1000);expect(f.port.groups()).toEqual([987]);
});
it.each(['socket','groups','gid','uid','effective','capability'] as const)('fails closed on %s without returning a usable startup identity',stage=>{
 const f=fixture();
 if(stage==='socket')f.port.socket=()=>({isSocket:()=>false,gid:987});
 if(stage==='groups')f.port.setGroups=()=>{throw Error('Denied');};
 if(stage==='gid')f.port.setGid=()=>{throw Error('Denied');};
 if(stage==='uid')f.port.setUid=()=>{throw Error('Denied');};
 if(stage==='effective')f.port.euid=()=>0;
 if(stage==='capability')f.port.capabilities=()=> 'CapEff:\t0000000000000001\nCapPrm:\t0000000000000000\nCapAmb:\t0000000000000000\n';
 expect(()=>adoptIdentity(f.port)).toThrow();
});
