import { expect,it } from 'vitest';
import { fixture,snapshot } from './fixture.js';
import { captureSettlementOperation,captureSettlementValue } from '../../src/adapters/outbound/sqlite/backend-settlement/index.js';
it('refuses raw permit/counter/tombstone creation and permanent identity mutation/replacement/deletion',()=>{
 const f=fixture();const before=snapshot(f);
 expect(()=>f.db.exec('DELETE FROM backend_cleanup_controls')).toThrow();
 expect(()=>f.db.exec('UPDATE backend_replay_storage SET original_count=1,charged_bytes=2560')).toThrow();expect(snapshot(f)).toBe(before);
 const run=f.db.prepare('SELECT * FROM runs').get()!;const attempt=f.db.prepare('SELECT * FROM attempts').get()!;
 const order=f.db.prepare('SELECT * FROM execution_orders').get()!;f.settle();
 for(const sql of ['UPDATE backend_retired_runs SET charged_bytes=2560','DELETE FROM backend_retired_runs','DELETE FROM backend_replay_storage',
  'INSERT OR REPLACE INTO backend_retired_runs SELECT * FROM backend_retired_runs'])expect(()=>f.db.exec(sql),sql).toThrow();
 for(const [table,row] of [['runs',run],['attempts',attempt],['execution_orders',order]] as const){
  const names=Object.keys(row);expect(()=>f.db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...names.map(name=>row[name]!)),table).toThrow();
 }
});
it('refuses malformed worker operations, accessors, reply scope and counter substitution',()=>{
 const f=fixture();let accessed=false;const getter=Object.defineProperty({},'kind',{enumerable:true,get(){accessed=true;return 'settleBackendOutput';}});
 for(const input of [getter,{...f.operation,extra:true},{...f.operation,messageId:0},
  {...f.operation,request:{...f.request,agentReply:{...f.request.agentReply,extra:true}}}])expect(()=>captureSettlementOperation(input)).toThrow();
 expect(accessed).toBe(false);const result=f.settle();expect(captureSettlementValue(f.operation,result)).toEqual(result);
 for(const patch of [{refundedBytes:-1},{chargedBytes:0},{extra:true},{key:{...f.key,runId:f.request.agentReply.requestDigest}}])expect(()=>captureSettlementValue(f.operation,{...result,...patch})).toThrow();
});
it('fences raw UUID case aliases for each compacted identity and execution order',async()=>{
 const {claimsFixture}=await import('../storage/dispatch-claim-fixtures.js');const {runCommand}=await import('../storage/runs-fixture.js');
 const {prepareRunCommand}=await import('../../src/application/runs/index.js');const {prepareOutputDeletion}=await import('../../src/application/output-deletion/index.js');
 const {cancelCommand}=await import('../storage/run-cancellation-fixtures.js');const {command,scope,uuid}=await import('../output-deletion/fixture.js');
 const {hash}=await import('../output-deletion/cleanup-ack/fixture.js');const f=claimsFixture();
 try{
  const runId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const attemptId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const raw=runCommand(uuid(60));const create=prepareRunCommand({kind:'createRun',id:runId,attemptId,requestedAt:raw.requestedAt,request:raw.request},hash);
  f.store.execute({kind:'run',command:create});f.store.execute({kind:'cancelRun',command:cancelCommand(runId)});
  const candidate=command({...f,key:{runId}});const deletion=prepareOutputDeletion({kind:'beginOutputDeletion',id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',requestedAt:candidate.requestedAt,request:candidate.request},hash);
  f.store.execute({kind:'beginOutputDeletion',command:deletion});const key={scope,id:deletion.id,runId};
  const records=['runs','attempts','output_deletion_intents'].map(table=>f.db.prepare(`SELECT * FROM ${table}`).get()!);
  f.store.execute({kind:'settleBackendOutput',request:{key,agentReply:null}});
  for(const [index,table] of ['runs','attempts','output_deletion_intents'].entries()){
   const row={...records[index],id:String(records[index]!.id).toUpperCase()};const names=Object.keys(row);
   expect(()=>f.db.prepare(`INSERT INTO ${table}(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...names.map(name=>Reflect.get(row,name)!))).toThrow();
  }
  expect(()=>f.db.prepare("INSERT INTO execution_orders(queue_order,purpose,attempt_id) VALUES(999,'performance',?)").run(attemptId.toUpperCase())).toThrow('retired execution order');
 }finally{f.db.close();}
});
