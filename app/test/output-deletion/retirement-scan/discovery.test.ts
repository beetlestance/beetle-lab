import {expect,it} from 'vitest';
import type {OutputDeletionPage} from '../../../src/ports/output-deletion-metadata.js';
import {claimsFixture} from '../../storage/dispatch-claim-fixtures.js';
import {ready,begin} from '../fixture.js';
import {cleaned} from '../cleanup-ack/fixture.js';
import type {RetirementRequest} from '@beetle/contracts/output-retirement';
function fixture(){
 const claims=claimsFixture(4000000);let id=70;
 const add=()=>{const f=ready(0,{claims,id:id++});return {...f,...begin(f,400+id,500+id)};};
 const scan=(limit=1,cursor?:string)=>claims.store.execute({kind:'scanOutputRetirements',query:{limit,...(cursor?{cursor}:{})}}) as OutputDeletionPage;
 const ack=(f:ReturnType<typeof add>)=>{const request=claims.store.execute({kind:'getOutputRetirementRequest',key:f.key}) as RetirementRequest;
  claims.store.execute({kind:'recordOutputCleanupAck',request:{key:f.key,reply:cleaned(request)}});};
 return {claims,add,scan,ack};
}
it('advances ACK-only physical pages, holds a captured horizon and discovers appended work on the next pass',()=>{
 const f=fixture();const first=f.add();const second=f.add();f.ack(first);
 const page=f.scan();expect(page.items).toEqual([]);expect(page.nextCursor).not.toBeNull();
 const third=f.add();const next=f.scan(1,page.nextCursor!);expect(next.items.map(item=>item.id)).toEqual([second.value.id]);expect(next.nextCursor).toBeNull();
 const round=f.scan(32);expect(round.items.map(item=>item.id)).toEqual([second.value.id,third.value.id]);
});
it('has no eligible work before file receipts and never includes unsent work',()=>{
 const f=fixture();expect(f.scan()).toEqual({items:[],nextCursor:null});
 const pending=ready(1,{claims:f.claims,id:70});begin(pending);expect(f.scan()).toEqual({items:[],nextCursor:null});
});
it('binds cursors to installation, page size, canonical encoding and the retirement lane',()=>{
 const f=fixture();f.add();f.add();const cursor=f.scan().nextCursor!;
 expect(()=>f.scan(2,cursor)).toThrow();expect(()=>f.scan(1,cursor+'=')).toThrow();
 const values=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')) as unknown[];
 values[1]='00000000-0000-4000-8000-000000000001';expect(()=>f.scan(1,Buffer.from(JSON.stringify(values)).toString('base64url'))).toThrow();
 values[0]='output-deletion-v1';expect(()=>f.scan(1,Buffer.from(JSON.stringify(values)).toString('base64url'))).toThrow();
 expect(()=>f.scan(33)).toThrow();expect(()=>f.scan(0)).toThrow();
});
it('bounds discovery to limit+1 physical candidates even when all selected rows are acknowledged',()=>{
 const f=fixture();const first=f.add();f.add();f.ack(first);
 const statements:string[]=[];const prepare=f.claims.db.prepare.bind(f.claims.db);
 f.claims.db.prepare=((sql:string)=>{statements.push(sql);return prepare(sql);}) as typeof f.claims.db.prepare;
 expect(f.scan().items).toEqual([]);
 expect(statements.find(sql=>sql.includes('FROM output_deletion_intents d'))).toContain('ORDER BY sequence LIMIT ?');
 const plan=prepare("EXPLAIN QUERY PLAN SELECT sequence FROM output_deletion_intents INDEXED BY output_deletion_retirable WHERE pending_files=0 AND kind IN ('source','absence') AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?").all(0,100,2);
 expect(plan.some(row=>String(row.detail).includes('output_deletion_retirable'))).toBe(true);
});
