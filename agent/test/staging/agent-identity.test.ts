import {expect,it,vi} from 'vitest';
import {verifyAgentIdentity} from '../../src/staging/agent-identity.js';
const installation={installationId:'synthetic',stagingRoot:'/synthetic',expectedDaemonId:'synthetic',agentContainer:'synthetic',agentImageId:'synthetic',user:'1000:1000',agentIdentity:'socket-group-drop-v1' as const};
function inspection(){return {Config:{User:'0:0',Entrypoint:['node','/beetle/agent/container.js'],Cmd:null},HostConfig:{Init:false,Privileged:false,PidMode:'',CapDrop:['ALL'],CapAdd:['CAP_SETGID','CAP_SETUID'],SecurityOpt:['no-new-privileges:true']}};}
const identity={pid:1,uid:1000,gid:1000,euid:1000,egid:1000,status:'CapEff:\t000000\nCapPrm:\t000000\nCapAmb:\t000000\n'};
it('requires the explicit package recipe and actual permanently dropped PID1 identity',()=>{
 expect(()=>verifyAgentIdentity(inspection(),installation,()=>identity)).not.toThrow();
 const read=vi.fn(()=>identity);expect(()=>verifyAgentIdentity({Config:{User:'1000:1000'}},{...installation,agentIdentity:undefined} as never,read)).not.toThrow();expect(read).not.toHaveBeenCalled();
 expect(()=>verifyAgentIdentity(inspection(),{...installation,agentIdentity:undefined} as never,()=>identity)).toThrow();
});
it.each([
 {Config:{...inspection().Config,User:'1000:1000'}},{Config:{...inspection().Config,Entrypoint:['/beetle/agent/container.js','node']}},
 {Config:{...inspection().Config,Cmd:['--unsafe']}},
 ...[{Init:true},{Privileged:true},{PidMode:'host'},{CapDrop:[]},{CapAdd:['CAP_SETGID','CAP_SETUID','CAP_CHOWN']},{SecurityOpt:[]}].map(change=>({HostConfig:{...inspection().HostConfig,...change}})),
])('refuses a changed container identity recipe %j',change=>{expect(()=>verifyAgentIdentity({...inspection(),...change},installation,()=>identity)).toThrow();});
it.each([{pid:2},{uid:0},{euid:0},{gid:0},{egid:0},{status:'CapEff:\t000001\nCapPrm:\t000000\nCapAmb:\t000000\n'},{status:'CapEff:\t000000\nCapPrm:\t000001\nCapAmb:\t000000\n'},{status:'CapEff:\t000000\nCapPrm:\t000000\nCapAmb:\t000001\n'}])('refuses an undropped or supervised process %j',change=>{
 expect(()=>verifyAgentIdentity(inspection(),installation,()=>({...identity,...change}))).toThrow();
});
