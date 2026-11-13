import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {DockerBackend} from '../../src/backends/docker/index.js';
import {producerBarrierFacts} from '../../src/producer-retirement/index.js';
import {fixture} from '../runtime-retirement/fixtures.js';
import {operation} from '../staging/fixtures.js';
const f=fixture();
function retained(path:string){const db=new DatabaseSync(path);try{
 return ['accepted_attempts','reservations','disk_holds','disk_retention_stats','event_spool','output_retirement_intents','task_staging_namespaces']
  .map(table=>({table,rows:db.prepare(`SELECT * FROM ${table} LIMIT 128`).all()}));
}finally{db.close();}}
it('recovers an actually committed lost association reply after worker termination/reopen without deleting early or changing charges',async()=>{
 const e=await f.ready(true);const intent=producerBarrierFacts(e.producer,e.owner.retirements).intent;
 const receive=Reflect.get(e.owner,'receive') as (reply:unknown)=>void;let enter!:()=>void;const committed=new Promise<void>(resolve=>{enter=resolve;});let held=false;
 Reflect.set(e.owner,'receive',(reply:unknown)=>{const value=reply&&typeof reply==='object'?Reflect.get(reply,'value'):undefined;
  if(!held&&value&&typeof value==='object'&&Reflect.get(value,'association')){held=true;enter();return;}receive.call(e.owner,reply);});
 const work=e.runtime.retire(e.producer,operation());const failed=expect(work).rejects.toBeTruthy();await committed;
 expect(e.docker.mutations()).toHaveLength(0);await e.owner.abort();await failed;expect(e.docker.mutations()).toHaveLength(0);
 const before=retained(e.journalPath);const reopened=await f.open(e.journalPath);const stored=await reopened.runtimeAssociations.read(intent);expect(stored).not.toBeNull();
 expect(await new DockerBackend(e.docker).removeRetired(e.plan,operation(),{runtimeId:'b'.repeat(64),daemonId:e.configuration.expectedDaemonId},
  {read:()=>reopened.runtimeAssociations.read(intent),commit:observed=>reopened.runtimeAssociations.commit(intent,observed)})).toEqual({outcome:'known',value:'removed'});
 expect(e.docker.volume).toBeUndefined();await f.close(reopened);expect(retained(e.journalPath)).toEqual(before);
});
