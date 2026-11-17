import {expect,it,vi} from 'vitest';
import {capacityTarget} from '../capacity/arguments.js';
import {runCapacityCli} from '../capacity-cli.js';
it('maps each supported maintenance flag to its own capacity kind',()=>{
 expect(capacityTarget('--memory-mib','1024')).toEqual({resource:'memory',bytes:1073741824});
 expect(capacityTarget('--output-pool-mib','512')).toEqual({resource:'outputPool',bytes:536870912});
});
it.each(['0','01','-1','1.5','1e3','Infinity','9999999999'])('rejects an unsafe or ambiguous MiB value %s',value=>{
 expect(()=>capacityTarget('--output-pool-mib',value)).toThrow();
});
it('rejects an unsupported capacity kind',()=>{expect(()=>capacityTarget('--storage-mib','512')).toThrow();});
it('refuses missing or competing capacity flags before reading installation files',async()=>{
 const base=['--request','/synthetic/request.json','--agent-worker','/synthetic/agent.js','--backend-worker','/synthetic/backend.js',
  '--operation-id','00000000-0000-4000-8000-000000000001'];
 const sink=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
 try{
  expect(await runCapacityCli([...base,'--memory-mib','1024','--output-pool-mib','512'])).toBe(2);
  expect(await runCapacityCli([...base,'--docker-socket','/synthetic/docker.sock'])).toBe(2);
  expect(sink.mock.calls.every(([text])=>text==='invalid_input\n')).toBe(true);
 }finally{sink.mockRestore();}
});
