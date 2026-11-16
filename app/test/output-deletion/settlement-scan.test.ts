import { expect,it } from 'vitest';
import type { OutputDeletionPage } from '../../src/ports/output-deletion-metadata.js';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { ready,begin,command,scope } from './fixture.js';
import { cleaned } from './cleanup-ack/fixture.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
function fixture(){
 const claims=claimsFixture(4000000);let id=70;
 const add=(acked=false)=>{const f=ready(0,{claims,id:id++});const deletion=begin(f,400+id,500+id);
  if(acked){const request=claims.store.execute({kind:'getOutputRetirementRequest',key:deletion.key}) as RetirementRequest;
   claims.store.execute({kind:'recordOutputCleanupAck',request:{key:deletion.key,reply:cleaned(request)}});}
  return{...f,...deletion};};
 const scan=(limit=1,cursor?:string)=>claims.store.execute({kind:'scanOutputSettlements',query:{limit,...(cursor?{cursor}:{})}}) as OutputDeletionPage;
 return{claims,add,scan};
}
it('bounds physical candidates before ACK filtering, advances empty pages and holds the original horizon',()=>{
 const f=fixture();f.add();const second=f.add(true);const first=f.scan();expect(first.items).toEqual([]);expect(first.nextCursor).not.toBeNull();
 const third=f.add(true);const next=f.scan(1,first.nextCursor!);expect(next.items.map(row=>row.id)).toEqual([second.value.id]);expect(next.nextCursor).toBeNull();
 expect(f.scan(32).items.map(row=>row.id)).toEqual([second.value.id,third.value.id]);
 const plan=f.claims.db.prepare('EXPLAIN QUERY PLAN SELECT sequence FROM output_deletion_intents WHERE sequence>? AND sequence<=? ORDER BY sequence LIMIT ?').all(0,100,2);
 expect(plan.some(row=>String(row.detail).includes('INTEGER PRIMARY KEY'))).toBe(true);
});
it('binds semantic cursor, installation, page size, canonical spelling and finite maximum',()=>{
 const f=fixture();f.add(true);f.add(true);const cursor=f.scan().nextCursor!;
 expect(()=>f.scan(2,cursor)).toThrow();expect(()=>f.scan(1,cursor+'=')).toThrow();
 expect(()=>f.claims.store.execute({kind:'scanOutputRetirements',query:{limit:1,cursor}})).toThrow();
 const parts=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) as unknown[];parts[1]='00000000-0000-4000-8000-000000000999';
 expect(()=>f.scan(1,Buffer.from(JSON.stringify(parts)).toString('base64url'))).toThrow();expect(()=>f.scan(33)).toThrow();
});
it.each(['never_started','settled'] as const)('includes positively released %s absence after ACK',disposition=>{
 const f=absenceFixture({admission:{state:'released',disposition},reason:disposition==='never_started'?'setup_failed':'artifact_incomplete'});
 f.ready();f.finalize();const deletion=command(f);f.store.execute({kind:'beginOutputDeletion',command:deletion});const key={scope,id:deletion.id,runId:f.key.runId};
 const request=f.store.execute({kind:'getOutputRetirementRequest',key}) as RetirementRequest;
 f.store.execute({kind:'recordOutputCleanupAck',request:{key,reply:cleaned(request)}});
 expect((f.store.execute({kind:'scanOutputSettlements',query:{limit:32}}) as OutputDeletionPage).items).toHaveLength(1);
});
it('includes positively unsent work without an agent ACK',()=>{
 const f=claimsFixture();try{
  const run=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(run.runId)});const deletion=command({...f,key:run});
  f.store.execute({kind:'beginOutputDeletion',command:deletion});
  expect((f.store.execute({kind:'scanOutputSettlements',query:{limit:32}}) as OutputDeletionPage).items[0]?.kind).toBe('unsent');
 }finally{f.db.close();}
});
it('discovers a positively rejected absence for retirement and requires its exact cleanup ACK before settlement discovery',()=>{
 const f=absenceFixture({end:0,admission:{state:'rejected',reason:'per_run_ceiling'},reason:'budget_unavailable'});
 f.ready();f.finalize();const deletion=command(f);f.store.execute({kind:'beginOutputDeletion',command:deletion});const key={scope,id:deletion.id,runId:f.key.runId};
 expect((f.store.execute({kind:'scanOutputRetirements',query:{limit:32}}) as OutputDeletionPage).items).toHaveLength(1);
 expect((f.store.execute({kind:'scanOutputSettlements',query:{limit:32}}) as OutputDeletionPage).items).toHaveLength(0);
 const request=f.store.execute({kind:'getOutputRetirementRequest',key}) as RetirementRequest;
 f.store.execute({kind:'recordOutputCleanupAck',request:{key,reply:cleaned(request)}});
 expect((f.store.execute({kind:'scanOutputSettlements',query:{limit:32}}) as OutputDeletionPage).items).toHaveLength(1);
});
