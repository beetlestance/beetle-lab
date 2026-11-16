import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ComposeGate} from '../compose/gate.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const path=await mkdtemp(join(tmpdir(),'beetle-compose-gate-'));roots.push(path);await chmod(path,0o700);
 const home={path,assertPins:async()=>{}};const identity={uid:process.getuid!(),gid:process.getgid!()};return {path,home,identity};
}
it('holds an exclusive configuration gate and preserves preparing state after a failed fresh operation',async()=>{
 const e=await fixture();const first=new ComposeGate(e.home,e.identity);const second=new ComposeGate(e.home,e.identity);
 try{await first.open(true,'a'.repeat(64));await expect(second.open(false,'a'.repeat(64))).rejects.toBeDefined();}
 finally{await second.close(false);await first.close(false);}
 const interrupted=new ComposeGate(e.home,e.identity);
 try{await expect(interrupted.open(false,'a'.repeat(64))).rejects.toMatchObject({code:'recovery_required'});}finally{await interrupted.close(false);}
});
it('commits readiness only after successful completion, matches installation/request and rejects changed intent',async()=>{
 const e=await fixture();const id=randomUUID();let gate=new ComposeGate(e.home,e.identity);
 await gate.open(true,'a'.repeat(64));await gate.ready(id);await gate.close(true);
 gate=new ComposeGate(e.home,e.identity);await gate.open(false,'a'.repeat(64));expect(()=>gate.matchInstallation(id)).not.toThrow();
 expect(()=>gate.matchInstallation(randomUUID())).toThrow();await gate.close(true);
 gate=new ComposeGate(e.home,e.identity);try{await expect(gate.open(false,'b'.repeat(64))).rejects.toMatchObject({code:'recovery_required'});}finally{await gate.close(false);}
});
