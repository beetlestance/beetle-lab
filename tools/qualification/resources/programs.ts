const kernel = String.raw`
const fs=require('node:fs');
function bounded(path){const fd=fs.openSync(path,'r');try{const b=Buffer.alloc(8193);const n=fs.readSync(fd,b,0,b.length,0);if(n>8192)throw Error('kernel bound');return b.subarray(0,n).toString().trim();}finally{fs.closeSync(fd);}}
function text(name){return bounded('/sys/fs/cgroup/'+name);}
function security(){const raw=bounded('/proc/self/status');return{noNewPrivs:Number(/^NoNewPrivs:\s+(\d+)$/m.exec(raw)[1]),capEff:/^CapEff:\s+([0-9a-f]+)$/m.exec(raw)[1]};}
function counters(name){return Object.fromEntries(text(name).split('\n').map(line=>{const[k,v]=line.trim().split(/\s+/);const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error('unsafe counter');return[k,n];}));}
function controls(){return{cpu:text('cpu.max'),memory:text('memory.max'),swap:text('memory.swap.max'),pids:text('pids.max')};}
const availableKiB=Number(/^MemAvailable:\s+(\d+) kB$/m.exec(bounded('/proc/meminfo'))?.[1]);
if(!Number.isSafeInteger(availableKiB)||availableKiB<1572864)throw Error('qualification VM headroom below 1.5GiB');
function report(kind,fields){process.stdout.write(JSON.stringify({kind,node:process.version,platform:process.platform,architecture:process.arch==='x64'?'amd64':process.arch,uid:process.getuid(),controls:controls(),security:security(),vmMemoryAvailableKiB:availableKiB,...fields})+'\n');}
`;
export const cpu =
  kernel +
  String.raw`
const {Worker}=require('node:worker_threads');
const before=counters('cpu.stat');const at=performance.now();
const workers=Array.from({length:4},()=>new Worker('for(;;){}',{eval:true}));
setTimeout(async()=>{await Promise.all(workers.map(w=>w.terminate()));report('cpu',{elapsedMs:performance.now()-at,before,after:counters('cpu.stat')});},8000);
`;
export const memory =
  kernel +
  String.raw`
report('memory-start',{events:counters('memory.events')});
const blocks=[];let allocated=0;
const timer=setInterval(()=>{blocks.push(Buffer.alloc(4*1024*1024,1));allocated+=4*1024*1024;
if(allocated>=768*1024*1024){clearInterval(timer);report('memory-not-enforced',{allocated});process.exitCode=3;}},20);
`;
export const pids =
  kernel +
  String.raw`
const {spawn}=require('node:child_process');
const children=[];const before=counters('pids.events');
async function main(){let refusal=null;try{
for(let n=0;n<160;n++){const result=await new Promise(resolve=>{const child=spawn('/bin/sleep',['30'],{stdio:'ignore'});const closed=new Promise(done=>child.once('close',done));child.once('spawn',()=>resolve({child,closed}));child.once('error',error=>resolve({refusal:error.code==='EAGAIN'?'EAGAIN':'other',closed}));});
if(result.refusal){await result.closed;refusal=result.refusal;break;}children.push(result);}
report('pids',{children:children.length,refusal,current:Number(text('pids.current')),before,after:counters('pids.events')});
}finally{for(const value of children)value.child.kill('SIGKILL');await Promise.all(children.map(value=>value.closed));}}
main().catch(()=>{process.stderr.write('pid fixture failed\n');process.exitCode=2;});
`;
export const descendants =
  kernel +
  String.raw`
const {spawn}=require('node:child_process');
process.on('SIGTERM',()=>{});
const baselineProcesses=text('cgroup.procs').split('\n').filter(Boolean).length;
const child=spawn('/bin/sh',['-c','trap "" TERM; sleep 60 & wait'],{stdio:'ignore'});
child.on('error',()=>{process.stderr.write('descendant fixture failed\n');process.exit(2);});
child.once('spawn',()=>setTimeout(()=>report('descendants-ready',{current:Number(text('pids.current')),baselineProcesses,processes:text('cgroup.procs').split('\n').filter(Boolean).length}),250));
setTimeout(()=>process.exit(3),55000);
`;
export const programs = { cpu, memory, pids, descendants } as const;
export type Case = keyof typeof programs;
