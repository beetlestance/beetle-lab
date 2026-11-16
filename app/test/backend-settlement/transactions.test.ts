import { expect,it } from 'vitest';
import { fixture } from './fixture.js';
import { purgeOrder } from '../../src/adapters/outbound/sqlite/backend-settlement/purge-order.js';
import { uuid } from '../output-deletion/fixture.js';
it('purges the exact completed original and credits only remaining debt once, keeping global receipts and inputs',()=>{
 const f=fixture(2);const before=f.usage();
 const retained=['receipts','suite_revisions','revision_input_pins','input_blobs','history_name_grams','settings'];
 const saved=retained.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all());
 const result=f.settle();expect(result).toMatchObject({version:1,key:f.key,kind:'source',chargedBytes:2560});
 expect(f.usage()).toBe(before-result.refundedBytes);
 const body=JSON.parse(f.db.prepare('SELECT tombstone_json FROM backend_retired_runs').get()?.tombstone_json as string);
 expect(result.refundedBytes).toBe(body.retainedPayloadBytes+65536+65536-2560);
 for(const [table] of purgeOrder)expect(f.db.prepare(`SELECT count(*) n FROM ${table}`).get()?.n,table).toBe(0);
 expect(retained.map(table=>f.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(saved);
 expect(f.db.prepare('SELECT * FROM backend_replay_storage').get()).toEqual({id:1,original_count:1,charged_bytes:2560});
 expect(f.settle()).toEqual(result);expect(f.usage()).toBe(before-result.refundedBytes);
 expect(f.store.execute({kind:'readBackendSettlement',key:f.key})).toEqual({kind:'settled',settlement:result});
 expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(f.db.prepare('PRAGMA defer_foreign_keys').get()?.defer_foreign_keys).toBe(0);
 for(const patch of [{tombstoneDigest:'e'.repeat(64)},{requestDigest:'e'.repeat(64)},{cleanupReplyDigest:'e'.repeat(64)}]){
  expect(()=>f.store.execute({...f.operation,request:{...f.request,agentReply:{...f.request.agentReply,...patch}}})).toThrow('conflict');
 }
 expect(()=>f.store.execute({kind:'readBackendSettlement',key:{...f.key,scope:{...f.key.scope,workspaceId:uuid(999)}}})).toThrow('conflict');
});
it('settles without fresh capacity after the already funded installation limit is lowered',()=>{
 const f=fixture();f.db.prepare("UPDATE settings SET value_json=json_set(value_json,'$.pool.storageBytes',0,'$.pool.freeSpaceReserveBytes',0),version=version+1 WHERE scope_key='installation'").run();
 expect(f.settle().chargedBytes).toBe(2560);
});
it('retains every charge when the cleaned ACK or exact agent reply is missing or contradictory',()=>{
 const f=fixture();const before=f.usage();
 for(const agentReply of [null,{...f.request.agentReply,cleanupReplyDigest:'f'.repeat(64)}]){
  expect(()=>f.store.execute({...f.operation,request:{key:f.key,agentReply}})).toThrow('conflict');expect(f.usage()).toBe(before);
 }
 expect(f.db.prepare('SELECT count(*) n FROM backend_retired_runs').get()?.n).toBe(0);expect(f.settle().kind).toBe('source');
});
