import { registerBackendSettlement } from '../../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import { registerRetentionAccounting } from '../../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import { transaction } from '../../../src/adapters/outbound/sqlite/schema.js';
import { insertCleanupAck } from '../../../src/adapters/outbound/sqlite/cleanup-ack-guard/index.js';
import { afterEach,expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeCanonicalJson } from '@beetle/contracts';
import { fixture,cleaned,preserved,hash } from './fixture.js';
import { uuid } from '../fixture.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function values(f:ReturnType<typeof fixture>){const body=encodeCanonicalJson(cleaned(f.request()),4096);return[f.key.id,body,hash(body),Buffer.byteLength(body)+512] as const;}
const insert='INSERT INTO backend_output_cleanup_acks(deletion_id,version,body_json,reply_digest,logical_bytes) VALUES(?,1,?,?,?)';
it('raw SQL cannot mint a valid-looking ACK before or after the trusted operation',()=>{
 const f=fixture();const data=values(f);expect(()=>f.db.prepare(insert).run(...data)).toThrow('validated transaction');
 expect(f.db.prepare('SELECT backend_cleanup_ack_authorized(?,?,?,?) allowed').get(...data)?.allowed).toBe(0);
 f.record();expect(f.db.prepare('SELECT backend_cleanup_ack_authorized(?,?,?,?) allowed').get(...data)?.allowed).toBe(0);
 for(const sql of ['INSERT OR REPLACE INTO backend_output_cleanup_acks SELECT * FROM backend_output_cleanup_acks','UPDATE backend_output_cleanup_acks SET version=2','DELETE FROM backend_output_cleanup_acks'])expect(()=>f.db.exec(sql)).toThrow();
 const flags=Number(f.db.prepare("SELECT flags FROM pragma_function_list WHERE name='backend_cleanup_ack_authorized'").get()?.flags);expect(flags&0x800).toBe(0);
});
it.each(['insert','commit'])('clears SQL permission and preserves all old state after %s failure',phase=>{
 const f=fixture();const data=values(f);const before=preserved(f);
 if(phase==='insert')f.db.exec("CREATE TRIGGER ack_fault BEFORE INSERT ON backend_output_cleanup_acks BEGIN SELECT RAISE(ABORT,'synthetic ACK failure'); END");
 else f.db.exec('CREATE TABLE ack_fault_parent(id PRIMARY KEY);CREATE TABLE ack_fault_child(id REFERENCES ack_fault_parent(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER ack_fault AFTER INSERT ON backend_output_cleanup_acks BEGIN INSERT INTO ack_fault_child VALUES(1); END');
 expect(()=>f.record()).toThrow();expect(f.read()).toEqual({kind:'missing'});expect(preserved(f)).toBe(before);
 expect(f.db.prepare('SELECT backend_cleanup_ack_authorized(?,?,?,?) allowed').get(...data)?.allowed).toBe(0);
 f.db.exec('DROP TRIGGER ack_fault');expect(f.record()).toMatchObject({reply:{state:'cleaned'}});
});
it('rejects nested trigger substitution inside a genuine permit window and rolls back the original',()=>{
 const f=fixture();const before=preserved(f);
 f.db.exec(`CREATE TRIGGER ack_substitute AFTER INSERT ON backend_output_cleanup_acks BEGIN
  INSERT INTO backend_output_cleanup_acks VALUES('${uuid(999)}',1,NEW.body_json,NEW.reply_digest,NEW.logical_bytes); END`);
 expect(()=>f.record()).toThrow('validated transaction');expect(f.read()).toEqual({kind:'missing'});expect(preserved(f)).toBe(before);
 expect(f.db.prepare('SELECT backend_cleanup_ack_authorized(?,?,?,?) allowed').get(...values(f))?.allowed).toBe(0);
});
it('missing callback registration on a raw connection fails closed',()=>{
 const f=fixture();const root=mkdtempSync(join(tmpdir(),'beetle-cleanup-ack-'));roots.push(root);const path=join(root,'metadata.sqlite');f.db.prepare('VACUUM INTO ?').run(path);
 const db=new DatabaseSync(path,{enableForeignKeyConstraints:true});try{registerRetentionAccounting(db);registerBackendSettlement(db);expect(()=>db.prepare(insert).run(...values(f))).toThrow('backend_cleanup_ack_authorized');expect(db.prepare('SELECT count(*) n FROM backend_output_cleanup_acks').get()?.n).toBe(0);}finally{db.close();}
});

it('rejects reentrant trusted insertion without exposing or retaining the outer permit',()=>{
 const f=fixture();const [deletionId,body,digest,logicalBytes]=values(f);
 f.db.function('ack_nested_insert',()=>{insertCleanupAck(f.db,{deletionId,body,digest,logicalBytes});return 1;});
 f.db.exec('CREATE TRIGGER ack_nested BEFORE INSERT ON backend_output_cleanup_acks BEGIN SELECT ack_nested_insert();END');
 expect(()=>f.record()).toThrow();expect(f.read()).toEqual({kind:'missing'});
 expect(f.db.prepare('SELECT backend_cleanup_ack_authorized(?,?,?,?) allowed').get(...values(f))?.allowed).toBe(0);
});

it('bounds trusted insertion input before retaining any SQL permission',()=>{
 const f=fixture();const [deletionId,,digest]=values(f);const before=preserved(f);const body='x'.repeat(4097);
 expect(()=>transaction(f.db,()=>insertCleanupAck(f.db,{deletionId,body,digest,logicalBytes:body.length+512}))).toThrow('invalid_input');
 expect(f.db.prepare('SELECT backend_cleanup_ack_authorized(?,?,?,?) allowed').get(...values(f))?.allowed).toBe(0);expect(preserved(f)).toBe(before);
});
