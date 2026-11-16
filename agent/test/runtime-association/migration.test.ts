import {expect,it} from 'vitest';
import {encodeCanonicalJson} from '@beetle/contracts';
import type {DatabaseSync} from 'node:sqlite';
import {initialize,JOURNAL_SCHEMA_VERSION} from '../../src/journal/schema.js';
import {migration021} from '../../src/journal/migration021.js';
import {transaction} from '../../src/journal/sql.js';
import {producerBarrierFacts} from '../../src/producer-retirement/index.js';
import {fixture} from '../runtime-retirement/fixtures.js';
import {asSchema20} from './legacy.js';
import {operation} from '../staging/fixtures.js';
const f=fixture();
function graph(db:DatabaseSync){return db.prepare("SELECT name,type,sql,rootpage FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();}
function rows(db:DatabaseSync){return ['accepted_attempts','reservations','disk_holds','disk_retention_stats','output_retirement_intents','task_staging_namespaces'].map(table=>({table,rows:db.prepare(`SELECT * FROM ${table} LIMIT 128`).all()}));}
it('migrates a real schema20 prefix with unchanged prior rows, charges and guards and no invented association',async()=>{
 const e=await f.ready(true);await f.close(e.owner);let db=initialize(e.journalPath);asSchema20(db);const before=rows(db);const schema=graph(db);
 transaction(db,()=>db.exec(migration021));
 for(const item of schema)expect(graph(db).find(row=>row.name===item.name&&row.type===item.type)).toEqual(item);
 db.close();db=initialize(e.journalPath);
 try{expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(JOURNAL_SCHEMA_VERSION);expect(rows(db)).toEqual(before);
  expect(db.prepare('SELECT count(*) n FROM runtime_cleanup_associations').get()?.n).toBe(0);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
});
it('rolls back a late trigger collision with unchanged prefix rows/schema/version',async()=>{
 const e=await f.ready();await f.close(e.owner);const db=initialize(e.journalPath);asSchema20(db);
 try{db.exec('CREATE TRIGGER runtime_association_retained BEFORE UPDATE ON accepted_attempts BEGIN SELECT 1;END;');const before=rows(db);const schema=graph(db);
  expect(()=>transaction(db,()=>db.exec(migration021))).toThrow();expect(rows(db)).toEqual(before);expect(graph(db)).toEqual(schema);expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(20);
 }finally{db.close();}
});
it('retains exact immutable association replay and refuses raw replacement/update/delete, foreign daemon and charge forgery',async()=>{
 const e=await f.ready(true);const intent=producerBarrierFacts(e.producer,e.owner.retirements).intent;await e.runtime.retire(e.producer,operation());const value=await e.owner.runtimeAssociations.read(intent);
 if(!value)throw Error('No association');await f.close(e.owner);const db=initialize(e.journalPath);const json=encodeCanonicalJson(value,1536);const before=rows(db);
 try{
  const insert=(body=json,charge=Buffer.byteLength(body)+512)=>db.prepare('INSERT OR REPLACE INTO runtime_cleanup_associations VALUES(?,?,?,?)').run(e.key.attemptId,body,Buffer.byteLength(body),charge);
  expect(()=>insert()).toThrow('invalid runtime association');expect(()=>db.exec('UPDATE runtime_cleanup_associations SET association_json=association_json')).toThrow('immutable runtime association');expect(()=>db.exec('DELETE FROM runtime_cleanup_associations')).toThrow('retained runtime association');
  expect(()=>asSchema20(db)).toThrow('retained runtime association');expect(()=>insert(encodeCanonicalJson({...value,daemonId:'foreign'},1536))).toThrow();expect(()=>insert(json,0)).toThrow();
  expect(rows(db)).toEqual(before);expect(db.prepare('SELECT association_json FROM runtime_cleanup_associations').get()?.association_json).toBe(json);
 }finally{db.close();}
});
it('rejects each mismatched initial association before any row exists',async()=>{
 const e=await f.ready(true);const intent=producerBarrierFacts(e.producer,e.owner.retirements).intent;if(intent.task.state!=='prepared')throw Error('No prepared task');
 const request=intent.request;const original={organizationId:request.organizationId,workspaceId:request.workspaceId,attemptId:request.attemptId,generation:request.generation,intentDigest:request.intentDigest};
 const value={version:1,purpose:'performance',original,retirementRequestDigest:intent.requestDigest,namespaceIdentity:intent.namespaceIdentity,taskNamespaceIdentity:intent.task.taskNamespaceIdentity,
  daemonId:e.configuration.expectedDaemonId,runtimeId:'b'.repeat(64),specDigest:e.plan.specDigest,mailboxName:`${e.plan.name}-live`};
 await f.close(e.owner);const db=initialize(e.journalPath);const before=rows(db);
 try{
  for(const changed of [{daemonId:'foreign'},{runtimeId:'f'.repeat(64)},{specDigest:'f'.repeat(64)},{mailboxName:'foreign-live'},{namespaceIdentity:'f'.repeat(64)},{taskNamespaceIdentity:'f'.repeat(64)}]){
   const json=encodeCanonicalJson({...value,...changed},1536);const bytes=Buffer.byteLength(json);
   expect(()=>db.prepare('INSERT INTO runtime_cleanup_associations VALUES(?,?,?,?)').run(e.key.attemptId,json,bytes,bytes+512)).toThrow('invalid runtime association');
  }
  const json=encodeCanonicalJson(value,1536);expect(()=>db.prepare('INSERT INTO runtime_cleanup_associations VALUES(?,?,?,?)').run(e.key.attemptId,json,Buffer.byteLength(json),0)).toThrow();
  expect(db.prepare('SELECT count(*) n FROM runtime_cleanup_associations').get()?.n).toBe(0);expect(rows(db)).toEqual(before);
 }finally{db.close();}
});
